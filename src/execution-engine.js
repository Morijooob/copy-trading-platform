export class ExecutionEngine {
  constructor({ persistence = null, state = null } = {}) {
    this.persistence = persistence;
    this.orders = new Map();
    this.ordersByClientId = new Map();
    this.nextId = 1;
    this.nextEventId = 1;
    this.auditLog = [];
    if (state !== null) this.restore(state);
  }

  createOrder({ symbol, side, quantity, timeoutMs = 5000, clientOrderId = null, eventSequence = null }) {
    if (!symbol || !side || !Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid order");
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("invalid timeout");
    if (clientOrderId !== null && (!clientOrderId || typeof clientOrderId !== "string")) throw new Error("invalid client order id");
    if (clientOrderId !== null && this.ordersByClientId.has(clientOrderId)) {
      const existing = this.orders.get(this.ordersByClientId.get(clientOrderId));
      if (existing.symbol !== symbol || existing.side !== side || existing.requestedQty !== quantity || existing.timeoutMs !== timeoutMs) throw new Error("conflicting client order id");
      this.assertEventSequence(existing, eventSequence);
      this.record(existing.id, "DUPLICATE_ORDER", { clientOrderId }, eventSequence);
      this.persist();
      return this.snapshot(existing);
    }
    if (eventSequence !== null && (!Number.isInteger(eventSequence) || eventSequence <= 0)) throw new Error("invalid event sequence");
    const id = String(this.nextId++);
    const order = { id, clientOrderId, symbol, side, requestedQty: quantity, filledQty: 0, status: "PENDING", timeoutMs, elapsedMs: 0, recovered: false, failureState: null, exchangeOrderId: null, retryCount: 0, lastEventSequence: null, processedFillIds: new Map() };
    this.orders.set(id, order);
    if (clientOrderId !== null) this.ordersByClientId.set(clientOrderId, id);
    this.record(id, "ORDER_CREATED", { symbol, side, quantity, timeoutMs, clientOrderId }, eventSequence);
    this.persist();
    return this.snapshot(order);
  }

  markSubmissionUnknown(id, reason = "UNKNOWN_OUTCOME", eventSequence = null) {
    const order = this.require(id);
    this.assertEventSequence(order, eventSequence);
    if (order.status === "FILLED") return this.snapshot(order);
    order.status = "UNKNOWN";
    order.failureState = "NETWORK_UNKNOWN";
    this.record(id, "SUBMISSION_UNKNOWN", { reason }, eventSequence);
    this.persist();
    return this.snapshot(order);
  }

  recordRetry(id, eventSequence = null) {
    const order = this.require(id);
    this.assertEventSequence(order, eventSequence);
    if (order.status !== "PENDING") throw new Error("retry requires reconciled pending order");
    order.retryCount += 1;
    this.record(id, "RETRY_SUBMISSION", { retryCount: order.retryCount }, eventSequence);
    this.persist();
    return this.snapshot(order);
  }

  reconcileExchangeState(id, exchangeState, eventSequence = null) {
    const order = this.require(id);
    this.assertEventSequence(order, eventSequence);
    if (!exchangeState || typeof exchangeState !== "object" || typeof exchangeState.found !== "boolean") throw new Error("exchange reconciliation must explicitly resolve found=true or found=false");
    if (exchangeState.found === true) {
      if (typeof exchangeState.exchangeOrderId !== "string" || !exchangeState.exchangeOrderId) throw new Error("invalid exchange order id");
      if (!Number.isFinite(exchangeState.filledQty) || exchangeState.filledQty < 0 || exchangeState.filledQty > order.requestedQty) throw new Error("invalid reconciled fill");
      order.exchangeOrderId = exchangeState.exchangeOrderId;
      order.filledQty = exchangeState.filledQty;
      order.status = order.filledQty === order.requestedQty ? "FILLED" : order.filledQty > 0 ? "PARTIAL" : "PENDING";
      order.failureState = null;
      order.recovered = true;
      this.record(id, "RECONCILED_FOUND", { exchangeOrderId: order.exchangeOrderId, filledQty: order.filledQty, status: order.status }, eventSequence);
    } else {
      order.status = "PENDING";
      order.failureState = null;
      order.recovered = true;
      this.record(id, "RECONCILED_NOT_FOUND", {}, eventSequence);
    }
    this.persist();
    return this.snapshot(order);
  }

  onExchangeFill(id, quantity, fillId = null, eventSequence = null) {
    const order = this.require(id);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid fill");
    this.assertEventSequence(order, eventSequence);
    if (fillId !== null) {
      const previousQuantity = order.processedFillIds.get(fillId);
      if (previousQuantity !== undefined) {
        if (previousQuantity !== quantity) throw new Error("conflicting fill id");
        this.record(id, "DUPLICATE_FILL", { fillId, quantity }, eventSequence);
        this.persist();
        return this.snapshot(order);
      }
      order.processedFillIds.set(fillId, quantity);
    }
    order.filledQty = Math.min(order.requestedQty, order.filledQty + quantity);
    order.status = order.filledQty === order.requestedQty ? "FILLED" : "PARTIAL";
    // Keep failureState: a late fill must not erase evidence that a crash/timeout happened.
    this.record(id, "EXCHANGE_FILL", { fillId, quantity, status: order.status }, eventSequence);
    this.persist();
    return this.snapshot(order);
  }

  tick(id, elapsedMs, eventSequence = null) {
    const order = this.require(id);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("invalid elapsed time");
    this.assertEventSequence(order, eventSequence);
    order.elapsedMs += elapsedMs;
    if (order.filledQty === order.requestedQty) order.status = "FILLED";
    else if (order.elapsedMs >= order.timeoutMs) { order.status = "TIMED_OUT"; order.failureState = "TIMED_OUT"; }
    this.record(id, "TICK", { elapsedMs, status: order.status }, eventSequence);
    this.persist();
    return this.snapshot(order);
  }

  crash(id, eventSequence = null) {
    const order = this.require(id);
    this.assertEventSequence(order, eventSequence);
    if (order.status !== "FILLED") { order.status = "CRASHED"; order.failureState = "CRASHED"; }
    this.record(id, "CRASH", { status: order.status }, eventSequence);
    this.persist();
    return this.snapshot(order);
  }

  recover(id, eventSequence = null) {
    const order = this.require(id);
    if (order.recovered || order.failureState === null) return this.snapshot(order);
    this.assertEventSequence(order, eventSequence);
    order.recovered = true;
    if (order.filledQty === order.requestedQty) order.status = "FILLED";
    else if (order.filledQty > 0) order.status = "PARTIAL";
    else order.status = "PENDING";
    this.record(id, "RECOVERY", { status: order.status, filledQty: order.filledQty }, eventSequence);
    this.persist();
    return this.snapshot(order);
  }

  getRecoverableOrders() { return [...this.orders.values()].filter((order) => order.status !== "FILLED").map((order) => this.snapshot(order)); }

  exportState() {
    return { nextOrderId: this.nextId, nextEventId: this.nextEventId, orders: [...this.orders.values()].map((order) => ({ ...this.snapshot(order), processedFillIds: [...order.processedFillIds.entries()] })), auditLog: this.getAuditLog() };
  }

  restore(state) {
    if (!state || !Array.isArray(state.orders) || !Array.isArray(state.auditLog)) throw new Error("invalid execution state");
    this.nextId = state.nextOrderId;
    this.nextEventId = state.nextEventId;
    this.auditLog = structuredClone(state.auditLog);
    for (const raw of state.orders) {
      const order = { ...structuredClone(raw), processedFillIds: new Map(raw.processedFillIds ?? []) };
      this.orders.set(order.id, order);
      if (order.clientOrderId !== null) this.ordersByClientId.set(order.clientOrderId, order.id);
    }
  }

  getAuditLog(id = null) { return structuredClone(id === null ? this.auditLog : this.auditLog.filter((event) => event.orderId === id)); }
  assertEventSequence(order, eventSequence) {
    if (eventSequence === null) return;
    if (!Number.isInteger(eventSequence) || eventSequence <= 0) throw new Error("invalid event sequence");
    if (order.lastEventSequence !== null && eventSequence <= order.lastEventSequence) throw new Error("out-of-order event");
  }
  record(orderId, type, payload, eventSequence = null) {
    const order = this.orders.get(orderId);
    this.assertEventSequence(order, eventSequence);
    if (order && eventSequence !== null) order.lastEventSequence = eventSequence;
    this.auditLog.push({ eventId: String(this.nextEventId++), orderId, type, payload: structuredClone(payload), eventSequence, recordedAt: this.auditLog.length });
  }
  persist() { if (this.persistence) this.persistence.save(this.exportState()); }
  require(id) { const order = this.orders.get(id); if (!order) throw new Error(`unknown order: ${id}`); return order; }
  snapshot(order) { const snapshot = structuredClone(order); delete snapshot.processedFillIds; return snapshot; }
}
