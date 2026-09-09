import { ExecutionEngine } from "./execution-engine.js";
import { NetworkResilience } from "./network-resilience.js";

export class DemoExecutionPipeline {
  constructor({ riskEngine, exchange, executionEngine = new ExecutionEngine() } = {}) {
    if (!riskEngine || typeof riskEngine.reserve !== "function") throw new Error("invalid risk engine");
    if (!exchange || typeof exchange.submitOrder !== "function" || typeof exchange.reconcile !== "function") throw new Error("invalid demo exchange");
    if (!executionEngine || typeof executionEngine.createOrder !== "function") throw new Error("invalid execution engine");

    this.riskEngine = riskEngine;
    this.exchange = exchange;
    this.executionEngine = executionEngine;
    this.network = new NetworkResilience({
      submit: (order) => {
        const result = this.exchange.submitOrder(order);
        return { accepted: true, exchangeOrderId: result.exchangeOrderId };
      },
      reconcile: (order) => {
        const result = this.exchange.reconcile(order.clientOrderId);
        return result.confirmed
          ? { confirmed: true, exchangeOrderId: result.exchangeOrderId, filledQty: result.filledQty, status: result.status }
          : { confirmed: false };
      }
    });
    this.orders = new Map();
    this.audit = [];
  }

  submit({ symbol, side, quantity, price, timeoutMs = 5000, clientOrderId } = {}) {
    if (!clientOrderId || typeof clientOrderId !== "string") throw new Error("invalid client order id");
    const existing = this.orders.get(clientOrderId);
    if (existing) return structuredClone(existing.result);

    const reservation = this.riskEngine.reserve({ side, quantity, price });
    if (!reservation.approved) {
      const result = { accepted: false, status: "RISK_REJECTED", risk: structuredClone(reservation), order: null, network: null };
      this.audit.push({ type: "PIPELINE_RISK_REJECTED", clientOrderId, risk: structuredClone(reservation) });
      return result;
    }

    let order;
    try {
      order = this.executionEngine.createOrder({ symbol, side, quantity, timeoutMs, clientOrderId });
    } catch (error) {
      this.riskEngine.releaseReservation(reservation.reservationId);
      throw error;
    }

    const record = { reservationId: reservation.reservationId, orderId: order.id, result: null };
    this.orders.set(clientOrderId, record);

    const network = this.network.execute({
      clientRequestId: clientOrderId,
      order: { clientOrderId, symbol, side, quantity, price }
    });

    if (network.status === "CONFIRMED") {
      this.syncConfirmed(order.id, network);
      this.riskEngine.commitReservation(reservation.reservationId);
    }

    const result = { accepted: true, status: network.status, risk: structuredClone(reservation), order: this.executionEngine.getOrder(order.id), network: structuredClone(network) };
    record.result = result;
    this.audit.push({ type: "PIPELINE_SUBMIT", clientOrderId, status: network.status, orderId: order.id });
    return structuredClone(result);
  }

  recover(clientOrderId) {
    const record = this.orders.get(clientOrderId);
    if (!record) throw new Error(`unknown client order: ${clientOrderId}`);

    const request = this.network.get(clientOrderId);
    if (!request) throw new Error(`unknown network request: ${clientOrderId}`);

    const reconciliation = this.exchange.reconcile(clientOrderId);
    if (reconciliation.confirmed) {
      const retry = this.network.retry(clientOrderId);
      const order = this.executionEngine.getOrder(record.orderId);
      this.syncConfirmed(record.orderId, retry);
      if (this.riskEngine.getReservation(record.reservationId)?.status === "RESERVED") {
        this.riskEngine.commitReservation(record.reservationId);
      }
      const result = { status: "CONFIRMED", order: this.executionEngine.getOrder(record.orderId), network: retry };
      record.result = { ...record.result, ...result };
      this.audit.push({ type: "PIPELINE_RECOVERED", clientOrderId, status: order?.status ?? null });
      return structuredClone(result);
    }

    const retried = this.network.retry(clientOrderId);
    if (retried.status === "CONFIRMED") {
      this.syncConfirmed(record.orderId, retried);
      if (this.riskEngine.getReservation(record.reservationId)?.status === "RESERVED") {
        this.riskEngine.commitReservation(record.reservationId);
      }
    } else if (this.riskEngine.getReservation(record.reservationId)?.status === "RESERVED") {
      this.riskEngine.releaseReservation(record.reservationId);
    }

    const result = { status: retried.status, order: this.executionEngine.getOrder(record.orderId), network: retried };
    record.result = { ...record.result, ...result };
    this.audit.push({ type: "PIPELINE_RECOVERY_ATTEMPT", clientOrderId, status: retried.status });
    return structuredClone(result);
  }

  syncConfirmed(orderId, networkRequest) {
    const exchangeState = this.exchange.reconcile(networkRequest.clientRequestId);
    if (!exchangeState.confirmed) throw new Error("exchange disappeared during confirmed reconciliation");
    this.executionEngine.reconcileExchangeState(orderId, {
      found: true,
      exchangeOrderId: exchangeState.exchangeOrderId,
      filledQty: exchangeState.filledQty
    });
  }

  getOrder(clientOrderId) {
    const record = this.orders.get(clientOrderId);
    return record ? this.executionEngine.getOrder(record.orderId) : null;
  }

  getAuditLog() { return structuredClone(this.audit); }
}
