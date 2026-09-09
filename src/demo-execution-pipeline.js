import { ExecutionEngine } from "./execution-engine.js";
import { NetworkResilience } from "./network-resilience.js";
import { PersistentNetworkResilience } from "./persistent-network-resilience.js";
import { NetworkPersistenceStore } from "./network-persistence-store.js";

export class DemoExecutionPipeline {
  constructor({ riskEngine, exchange, executionEngine = new ExecutionEngine(), network = null, state = null } = {}) {
    if (!riskEngine || typeof riskEngine.reserve !== "function" || typeof riskEngine.exportState !== "function") throw new Error("invalid risk engine");
    if (!exchange || typeof exchange.submitOrder !== "function" || typeof exchange.reconcile !== "function") throw new Error("invalid demo exchange");
    if (!executionEngine || typeof executionEngine.createOrder !== "function" || typeof executionEngine.exportState !== "function") throw new Error("invalid execution engine");
    this.riskEngine = riskEngine; this.exchange = exchange; this.executionEngine = executionEngine;
    this.network = network ?? new PersistentNetworkResilience({
      submit: (order) => { const result = this.exchange.submitOrder(order); return { accepted: true, exchangeOrderId: result.exchangeOrderId }; },
      reconcile: (order) => { const result = this.exchange.reconcile(order.clientOrderId); return result.confirmed ? { confirmed: true, exchangeOrderId: result.exchangeOrderId, filledQty: result.filledQty, status: result.status } : { confirmed: false }; },
      store: new NetworkPersistenceStore(state?.network ?? null)
    });
    if (!(this.network instanceof NetworkResilience) || typeof this.network.execute !== "function") throw new Error("invalid network resilience");
    this.orders = new Map(); this.audit = [];
    if (state !== null) this.restoreState(state);
  }

  submit({ symbol, side, quantity, price, timeoutMs = 5000, clientOrderId } = {}) {
    if (!clientOrderId || typeof clientOrderId !== "string") throw new Error("invalid client order id");
    const existing = this.orders.get(clientOrderId); if (existing) return structuredClone(existing.result);
    const reservation = this.riskEngine.reserve({ side, quantity, price });
    if (!reservation.approved) { const result = { accepted: false, status: "RISK_REJECTED", risk: structuredClone(reservation), order: null, network: null }; this.audit.push({ type: "PIPELINE_RISK_REJECTED", clientOrderId, risk: structuredClone(reservation) }); return result; }
    let order;
    try { order = this.executionEngine.createOrder({ symbol, side, quantity, timeoutMs, clientOrderId }); }
    catch (error) { this.riskEngine.releaseReservation(reservation.reservationId); throw error; }
    const record = { reservationId: reservation.reservationId, orderId: order.id, unitNotional: reservation.notional / quantity, settledFilledQty: 0, result: null };
    this.orders.set(clientOrderId, record);
    const network = this.network.execute({ clientRequestId: clientOrderId, order: { clientOrderId, symbol, side, quantity, price } });
    if (network.status === "CONFIRMED") {
      try { this.syncConfirmed(order.id, network); this.settleFilled(record, order.id); }
      catch (error) { const pending = { accepted: true, status: "CONFIRMED_RECONCILIATION_PENDING", error: error instanceof Error ? error.message : String(error), risk: structuredClone(reservation), order: this.executionEngine.getOrder(order.id), network: structuredClone(network) }; record.result = pending; this.audit.push({ type: "PIPELINE_CONFIRMED_RECONCILIATION_PENDING", clientOrderId, orderId: order.id }); return structuredClone(pending); }
    }
    const result = { accepted: true, status: network.status, risk: structuredClone(reservation), order: this.executionEngine.getOrder(order.id), network: structuredClone(network) };
    record.result = result; this.audit.push({ type: "PIPELINE_SUBMIT", clientOrderId, status: network.status, orderId: order.id }); return structuredClone(result);
  }

  recover(clientOrderId) {
    const record = this.orders.get(clientOrderId); if (!record) throw new Error(`unknown client order: ${clientOrderId}`);
    const request = this.network.get(clientOrderId); if (!request) throw new Error(`unknown network request: ${clientOrderId}`);
    const retried = this.network.retry(clientOrderId);
    if (retried.status === "CONFIRMED") { this.syncConfirmed(record.orderId, retried); this.settleFilled(record, record.orderId); }
    const result = { status: retried.status, order: this.executionEngine.getOrder(record.orderId), network: retried };
    record.result = { ...(record.result ?? {}), ...result }; this.audit.push({ type: "PIPELINE_RECOVERY_ATTEMPT", clientOrderId, status: retried.status }); return structuredClone(result);
  }

  recoverAfterRestart() {
    if (typeof this.network.recoverAfterRestart !== "function") throw new Error("network does not support restart recovery");
    const recovered = this.network.recoverAfterRestart(); const results = [];
    for (const request of recovered) {
      const record = this.orders.get(request.clientRequestId); if (!record) throw new Error(`missing pipeline order for recovered request: ${request.clientRequestId}`);
      if (request.status === "CONFIRMED") { this.syncConfirmed(record.orderId, request); this.settleFilled(record, record.orderId); }
      const result = { status: request.status, order: this.executionEngine.getOrder(record.orderId), network: request };
      record.result = { ...(record.result ?? {}), ...result }; results.push(structuredClone(result)); this.audit.push({ type: "PIPELINE_RESTART_RECOVERY", clientOrderId: request.clientRequestId, status: request.status });
    }
    return results;
  }

  syncConfirmed(orderId, networkRequest) {
    const exchangeState = this.exchange.reconcile(networkRequest.clientRequestId);
    if (!exchangeState.confirmed) throw new Error("exchange disappeared during confirmed reconciliation");
    this.executionEngine.reconcileExchangeState(orderId, { found: true, exchangeOrderId: exchangeState.exchangeOrderId, filledQty: exchangeState.filledQty });
    return exchangeState;
  }

  settleFilled(record, orderId) {
    const order = this.executionEngine.getOrder(orderId);
    const deltaQty = order.filledQty - record.settledFilledQty;
    if (deltaQty < 0) throw new Error("filled quantity regressed");
    if (deltaQty === 0) return;
    const amount = deltaQty * record.unitNotional;
    this.riskEngine.settleReservation(record.reservationId, amount);
    record.settledFilledQty = order.filledQty;
  }

  exportState() {
    if (typeof this.network.store?.load !== "function") throw new Error("network persistence is required");
    return { version: 1, risk: this.riskEngine.exportState(), execution: this.executionEngine.exportState(), network: this.network.store.load(), orders: [...this.orders.entries()].map(([clientOrderId, record]) => [clientOrderId, structuredClone(record)]), audit: this.getAuditLog() };
  }

  restoreState(state) {
    if (!state || state.version !== 1 || !Array.isArray(state.orders) || !Array.isArray(state.audit)) throw new Error("invalid pipeline state");
    this.riskEngine.restore(state.risk); this.executionEngine.restore(state.execution); this.orders = new Map(state.orders.map(([clientOrderId, record]) => [clientOrderId, structuredClone(record)])); this.audit = structuredClone(state.audit);
    if (!this.network.store?.save) throw new Error("network persistence is required");
    this.network.store.save(state.network); if (typeof this.network.restore === "function") this.network.restore();
    for (const [clientOrderId, record] of this.orders) {
      if (record.orderId === undefined || record.reservationId === undefined || !Number.isFinite(record.unitNotional) || !Number.isFinite(record.settledFilledQty)) throw new Error(`invalid pipeline record: ${clientOrderId}`);
      if (!this.network.get(clientOrderId)) throw new Error(`missing network request: ${clientOrderId}`);
      if (!this.executionEngine.getOrder(record.orderId)) throw new Error(`missing execution order: ${record.orderId}`);
      if (!this.riskEngine.getReservation(record.reservationId) && this.executionEngine.getOrder(record.orderId).filledQty < this.executionEngine.getOrder(record.orderId).requestedQty) throw new Error(`missing risk reservation: ${clientOrderId}`);
    }
  }

  getOrder(clientOrderId) { const record = this.orders.get(clientOrderId); return record ? this.executionEngine.getOrder(record.orderId) : null; }
  getAuditLog() { return structuredClone(this.audit); }
}
