export class RiskControlledExecution {
  constructor({ riskEngine, executionEngine }) {
    if (!riskEngine || typeof riskEngine.approve !== "function") throw new Error("invalid risk engine");
    if (!executionEngine || typeof executionEngine.createOrder !== "function") throw new Error("invalid execution engine");
    this.riskEngine = riskEngine;
    this.executionEngine = executionEngine;
    this.audit = [];
  }

  submit({ symbol, side, quantity, price, timeoutMs = 5000, clientOrderId = null, eventSequence = null } = {}) {
    const existing = clientOrderId === null ? null : this.executionEngine.getOrderByClientId?.(clientOrderId);

    if (existing !== null && existing !== undefined) {
      if (existing.symbol !== symbol || existing.side !== side || existing.requestedQty !== quantity || existing.timeoutMs !== timeoutMs) {
        throw new Error("conflicting client order id");
      }
      const notional = quantity * price;
      const decision = {
        approved: true,
        failedChecks: [],
        notional,
        reason: "IDEMPOTENT_DUPLICATE"
      };
      this.audit.push(structuredClone({ symbol, side, quantity, price, clientOrderId, approved: true, failedChecks: [], notional }));
      const order = this.executionEngine.createOrder({ symbol, side, quantity, timeoutMs, clientOrderId, eventSequence });
      return { accepted: true, risk: decision, order };
    }

    const decision = this.riskEngine.approve({ side, quantity, price });
    const entry = { symbol, side, quantity, price, clientOrderId, approved: decision.approved, failedChecks: [...decision.failedChecks], notional: decision.notional };
    this.audit.push(structuredClone(entry));

    if (!decision.approved) {
      return { accepted: false, risk: structuredClone(decision), order: null };
    }

    this.riskEngine.reserveExposure(decision.notional);

    try {
      const order = this.executionEngine.createOrder({ symbol, side, quantity, timeoutMs, clientOrderId, eventSequence });
      return { accepted: true, risk: structuredClone(decision), order };
    } catch (error) {
      this.riskEngine.releaseExposure(decision.notional);
      throw error;
    }
  }

  getAuditLog() {
    return structuredClone(this.audit);
  }
}
