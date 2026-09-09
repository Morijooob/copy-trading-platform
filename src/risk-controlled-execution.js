export class RiskControlledExecution {
  constructor({ riskEngine, executionEngine, state = null }) {
    if (!riskEngine || typeof riskEngine.approve !== "function") throw new Error("invalid risk engine");
    if (!executionEngine || typeof executionEngine.createOrder !== "function") throw new Error("invalid execution engine");
    this.riskEngine = riskEngine;
    this.executionEngine = executionEngine;
    this.audit = [];
    this.reservations = new Map();
    if (state !== null) this.restoreState(state);
  }

  submit({ symbol, side, quantity, price, timeoutMs = 5000, clientOrderId = null, eventSequence = null } = {}) {
    const existing = clientOrderId === null ? null : this.executionEngine.getOrderByClientId?.(clientOrderId);

    if (existing !== null && existing !== undefined) {
      if (existing.symbol !== symbol || existing.side !== side || existing.requestedQty !== quantity || existing.timeoutMs !== timeoutMs) {
        throw new Error("conflicting client order id");
      }
      if (existing.status !== "FILLED" && !this.reservations.has(existing.id)) throw new Error("missing exposure reservation");
      const notional = quantity * price;
      const decision = { approved: true, failedChecks: [], notional, reason: "IDEMPOTENT_DUPLICATE" };
      this.audit.push(structuredClone({ symbol, side, quantity, price, clientOrderId, approved: true, failedChecks: [], notional }));
      const order = this.executionEngine.createOrder({ symbol, side, quantity, timeoutMs, clientOrderId, eventSequence });
      return { accepted: true, risk: decision, order };
    }

    const decision = this.riskEngine.approve({ side, quantity, price });
    const entry = { symbol, side, quantity, price, clientOrderId, approved: decision.approved, failedChecks: [...decision.failedChecks], notional: decision.notional };
    this.audit.push(structuredClone(entry));
    if (!decision.approved) return { accepted: false, risk: structuredClone(decision), order: null };

    this.riskEngine.reserveExposure(decision.notional);
    try {
      const order = this.executionEngine.createOrder({ symbol, side, quantity, timeoutMs, clientOrderId, eventSequence });
      this.reservations.set(order.id, { notional: decision.notional, price, remainingNotional: decision.notional });
      return { accepted: true, risk: structuredClone(decision), order };
    } catch (error) {
      this.riskEngine.releaseExposure(decision.notional);
      throw error;
    }
  }

  onExchangeFill(id, quantity, fillId = null, eventSequence = null) {
    const current = this.executionEngine.getOrderById?.(id);
    if (!current) throw new Error(`unknown order: ${id}`);
    const updated = this.executionEngine.onExchangeFill(id, quantity, fillId, eventSequence);
    const deltaQty = updated.filledQty - current.filledQty;
    if (deltaQty > 0) this.commitFill(id, deltaQty);
    return updated;
  }

  reconcileExchangeState(id, exchangeState, eventSequence = null) {
    const current = this.executionEngine.getOrderById?.(id);
    if (!current) throw new Error(`unknown order: ${id}`);
    const updated = this.executionEngine.reconcileExchangeState(id, exchangeState, eventSequence);
    if (exchangeState.found === true) {
      const deltaQty = updated.filledQty - current.filledQty;
      if (deltaQty > 0) this.commitFill(id, deltaQty);
    } else {
      this.releaseReservation(id, "RECONCILED_NOT_FOUND");
    }
    return updated;
  }

  releaseReservation(id, reason = "CONFIRMED_TERMINAL") {
    const reservation = this.reservations.get(id);
    if (!reservation) return false;
    if (reservation.remainingNotional > 0) this.riskEngine.releaseExposure(reservation.remainingNotional);
    this.reservations.delete(id);
    this.audit.push({ type: "EXPOSURE_RESERVATION_RELEASED", orderId: id, notional: reservation.remainingNotional, reason: String(reason) });
    return true;
  }

  commitFill(id, filledQuantity) {
    const reservation = this.reservations.get(id);
    if (!reservation) throw new Error("missing exposure reservation");
    const notional = filledQuantity * reservation.price;
    if (notional > reservation.remainingNotional) throw new Error("filled exposure exceeds reservation");
    this.riskEngine.commitReservedExposure(notional);
    reservation.remainingNotional -= notional;
    if (reservation.remainingNotional === 0) this.reservations.delete(id);
    this.audit.push({ type: "EXPOSURE_RESERVATION_COMMITTED", orderId: id, notional, remainingNotional: reservation.remainingNotional });
  }

  exportState() {
    return {
      risk: this.riskEngine.exportState?.(),
      audit: this.getAuditLog(),
      reservations: [...this.reservations.entries()].map(([id, value]) => [id, structuredClone(value)])
    };
  }

  restoreState(state) {
    if (!state || !Array.isArray(state.audit) || !Array.isArray(state.reservations)) throw new Error("invalid risk-controlled execution state");
    if (state.risk !== undefined) {
      if (typeof this.riskEngine.restoreState !== "function") throw new Error("risk engine cannot restore state");
      this.riskEngine.restoreState(state.risk);
    }
    this.audit = structuredClone(state.audit);
    this.reservations = new Map(state.reservations.map(([id, value]) => [id, structuredClone(value)]));
    const reservationTotal = [...this.reservations.values()].reduce((sum, value) => sum + value.remainingNotional, 0);
    if (Math.abs(reservationTotal - this.riskEngine.reservedExposure) > 1e-9) throw new Error("risk reservation state mismatch");
  }

  getAuditLog() { return structuredClone(this.audit); }
}
