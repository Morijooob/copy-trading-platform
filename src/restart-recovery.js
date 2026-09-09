export class RestartRecoveryCoordinator {
  constructor({ engine, persistence, exchange }) {
    if (!engine || !persistence || !exchange || typeof exchange.findByClientOrderId !== "function") {
      throw new Error("engine, persistence and exchange reconciliation are required");
    }
    this.engine = engine;
    this.persistence = persistence;
    this.exchange = exchange;
  }

  static restart({ persistence, exchange }) {
    const state = persistence.load();
    const { ExecutionEngine } = this.engineModule();
    const engine = new ExecutionEngine({ persistence, state });
    return new RestartRecoveryCoordinator({ engine, persistence, exchange });
  }

  // Kept injectable through a tiny indirection so this module has no global singleton state.
  engineModule() {
    throw new Error("engineModule must be overridden by the runtime bootstrap");
  }

  async recoverAll() {
    const candidates = this.engine.getRecoverableOrders();
    const results = [];

    for (const order of candidates) {
      if (!order.clientOrderId) {
        results.push({ orderId: order.id, action: "BLOCKED", reason: "missing clientOrderId" });
        continue;
      }

      const exchangeState = await this.exchange.findByClientOrderId(order.clientOrderId);
      if (!exchangeState || typeof exchangeState.found !== "boolean") {
        throw new Error(`reconciliation must explicitly resolve order ${order.id}`);
      }

      const reconciled = this.engine.reconcileExchangeState(order.id, exchangeState);
      results.push({
        orderId: order.id,
        action: exchangeState.found ? "CONFIRMED_FROM_EXCHANGE" : "SAFE_TO_RETRY",
        status: reconciled.status,
        filledQty: reconciled.filledQty,
        exchangeOrderId: reconciled.exchangeOrderId
      });
    }

    return results;
  }
}
