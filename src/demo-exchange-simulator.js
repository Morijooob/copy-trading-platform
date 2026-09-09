export class DemoExchangeSimulator {
  constructor({ marketPrice = 100, latencyMs = 50, slippageBps = 0, scenarios = {}, state = null } = {}) {
    if (!Number.isFinite(marketPrice) || marketPrice <= 0) throw new Error("invalid market price");
    if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error("invalid latency");
    if (!Number.isFinite(slippageBps) || slippageBps < 0) throw new Error("invalid slippage");
    this.marketPrice = marketPrice;
    this.latencyMs = latencyMs;
    this.slippageBps = slippageBps;
    this.scenarios = structuredClone(scenarios);
    this.orders = new Map();
    this.audit = [];
    this.nextOrderId = 1;
    this.nextFillId = 1;
    this.connected = true;
    this.crashed = false;
    if (state !== null) this.restore(state);
  }

  submitOrder({ clientOrderId, symbol, side, quantity, price = null } = {}) {
    this.validateOrder({ clientOrderId, symbol, side, quantity });
    if (this.crashed) throw new Error("exchange crashed");
    if (!this.connected) throw new Error("network disconnected");
    const existing = this.orders.get(clientOrderId);
    if (existing) return this.snapshot(existing, "DUPLICATE_ORDER");

    const scenario = this.scenarios[clientOrderId] ?? "FULL_FILL";
    const exchangeOrderId = `DEMO-${this.nextOrderId++}`;
    const executionPrice = this.executionPrice(side, price ?? this.marketPrice);
    const order = {
      exchangeOrderId, clientOrderId, symbol, side, requestedQty: quantity,
      filledQty: 0, averagePrice: null, status: "OPEN", scenario,
      latencyMs: this.latencyMs, executionPrice, fills: []
    };
    this.orders.set(clientOrderId, order);
    this.record("ORDER_ACCEPTED", { clientOrderId, exchangeOrderId, scenario });
    this.applyScenario(order);

    if (scenario === "TIMEOUT" || scenario === "CRASH" || scenario === "NETWORK_FAILURE") {
      throw new Error(`${scenario.toLowerCase()} simulated after acceptance`);
    }
    return this.snapshot(order);
  }

  reconcile(clientOrderId) {
    const order = this.orders.get(clientOrderId);
    this.record("RECONCILE", { clientOrderId, found: Boolean(order) });
    if (!order) return { confirmed: false, clientOrderId };
    return {
      confirmed: true,
      exchangeOrderId: order.exchangeOrderId,
      filledQty: order.filledQty,
      averagePrice: order.averagePrice,
      status: order.status
    };
  }

  getOrder(clientOrderId) {
    const order = this.orders.get(clientOrderId);
    return order ? this.snapshot(order) : null;
  }

  disconnect() { this.connected = false; this.record("NETWORK_DISCONNECT", {}); }
  reconnect() { this.connected = true; this.record("NETWORK_RECONNECT", {}); }
  crash() { this.crashed = true; this.record("EXCHANGE_CRASH", {}); }
  restart() { this.crashed = false; this.connected = true; this.record("EXCHANGE_RESTART", {}); }

  exportState() {
    return {
      marketPrice: this.marketPrice, latencyMs: this.latencyMs, slippageBps: this.slippageBps,
      nextOrderId: this.nextOrderId, nextFillId: this.nextFillId,
      connected: this.connected, crashed: this.crashed,
      orders: [...this.orders.values()].map((order) => structuredClone(order)),
      audit: this.getAuditLog()
    };
  }

  restore(state) {
    if (!state || !Array.isArray(state.orders) || !Array.isArray(state.audit)) throw new Error("invalid exchange state");
    if (!Number.isFinite(state.marketPrice) || state.marketPrice <= 0) throw new Error("invalid exchange market price");
    if (!Number.isFinite(state.latencyMs) || state.latencyMs < 0) throw new Error("invalid exchange latency");
    if (!Number.isFinite(state.slippageBps) || state.slippageBps < 0) throw new Error("invalid exchange slippage");
    if (!Number.isInteger(state.nextOrderId) || state.nextOrderId < 1) throw new Error("invalid exchange order counter");
    if (!Number.isInteger(state.nextFillId) || state.nextFillId < 1) throw new Error("invalid exchange fill counter");
    this.marketPrice = state.marketPrice;
    this.latencyMs = state.latencyMs;
    this.slippageBps = state.slippageBps;
    this.nextOrderId = state.nextOrderId;
    this.nextFillId = state.nextFillId;
    this.connected = Boolean(state.connected);
    this.crashed = Boolean(state.crashed);
    this.audit = structuredClone(state.audit);
    this.orders = new Map(state.orders.map((order) => [order.clientOrderId, structuredClone(order)]));
  }

  getAuditLog() { return structuredClone(this.audit); }

  applyScenario(order) {
    if (order.scenario === "TIMEOUT" || order.scenario === "CRASH" || order.scenario === "NETWORK_FAILURE") return;
    if (order.scenario === "PARTIAL_FILL") {
      this.fill(order, order.requestedQty / 2);
      return;
    }
    if (order.scenario !== "FULL_FILL") throw new Error(`unknown scenario: ${order.scenario}`);
    this.fill(order, order.requestedQty);
  }

  completePartialFill(clientOrderId) {
    const order = this.require(clientOrderId);
    if (order.filledQty >= order.requestedQty) return this.snapshot(order);
    this.fill(order, order.requestedQty - order.filledQty);
    return this.snapshot(order);
  }

  fill(order, quantity) {
    const normalizedQuantity = this.roundNumber(quantity);
    const fillId = `DFILL-${this.nextFillId++}`;
    const priorValue = order.filledQty * (order.averagePrice ?? order.executionPrice);
    const fillValue = normalizedQuantity * order.executionPrice;
    order.filledQty = this.roundNumber(order.filledQty + normalizedQuantity);
    order.averagePrice = this.roundPrice((priorValue + fillValue) / order.filledQty);
    order.status = order.filledQty === order.requestedQty ? "FILLED" : "PARTIAL";
    order.fills.push({ fillId, quantity: normalizedQuantity, price: order.executionPrice });
    this.record("FILL", { exchangeOrderId: order.exchangeOrderId, fillId, quantity: normalizedQuantity, price: order.executionPrice });
  }

  executionPrice(side, referencePrice) {
    const factor = this.slippageBps / 10000;
    const rawPrice = side === "BUY" ? referencePrice * (1 + factor) : referencePrice * (1 - factor);
    return this.roundPrice(rawPrice);
  }

  roundNumber(value) {
    return Number(value.toFixed(12));
  }

  roundPrice(price) {
    return this.roundNumber(price);
  }

  validateOrder({ clientOrderId, symbol, side, quantity }) {
    if (!clientOrderId || typeof clientOrderId !== "string") throw new Error("invalid client order id");
    if (!symbol || typeof symbol !== "string") throw new Error("invalid symbol");
    if (side !== "BUY" && side !== "SELL") throw new Error("invalid side");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid quantity");
  }

  require(clientOrderId) {
    const order = this.orders.get(clientOrderId);
    if (!order) throw new Error(`unknown client order: ${clientOrderId}`);
    return order;
  }

  snapshot(order, event = null) {
    const result = structuredClone(order);
    if (event) result.event = event;
    return result;
  }

  record(type, payload) {
    this.audit.push({ eventId: `DEVENT-${this.audit.length + 1}`, type, payload: structuredClone(payload), recordedAt: this.audit.length });
  }
}
