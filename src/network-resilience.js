export class NetworkResilience {
  constructor({ submit, reconcile }) {
    if (typeof submit !== "function" || typeof reconcile !== "function") {
      throw new Error("invalid network handlers");
    }
    this.submit = submit;
    this.reconcile = reconcile;
    this.requests = new Map();
    this.nextId = 1;
  }

  execute({ clientRequestId, order }) {
    this.validateRequest(clientRequestId, order);

    const existing = this.requests.get(clientRequestId);
    if (existing) return structuredClone(existing);

    const request = {
      id: String(this.nextId++),
      clientRequestId,
      order: structuredClone(order),
      status: "PENDING",
      attempts: 0,
      exchangeOrderId: null,
      lastError: null,
      reconciled: false
    };
    this.requests.set(clientRequestId, request);
    return this.attempt(request);
  }

  retry(clientRequestId) {
    const request = this.require(clientRequestId);
    if (request.status === "CONFIRMED") return structuredClone(request);

    const reconciliation = this.reconcileResult(request);
    if (reconciliation.confirmed) {
      request.status = "CONFIRMED";
      request.exchangeOrderId = reconciliation.exchangeOrderId ?? request.exchangeOrderId;
      request.reconciled = true;
      request.lastError = null;
      return structuredClone(request);
    }

    request.reconciled = true;
    return this.attempt(request);
  }

  attempt(request) {
    request.attempts += 1;
    request.status = "SENDING";
    request.lastError = null;

    try {
      const result = this.submit(structuredClone(request.order), request.attempts);
      if (!result || result.accepted !== true || !result.exchangeOrderId) {
        throw new Error("invalid exchange response");
      }
      request.exchangeOrderId = result.exchangeOrderId;
      request.status = "CONFIRMED";
      request.reconciled = false;
      return structuredClone(request);
    } catch (error) {
      request.status = "UNKNOWN";
      request.lastError = error instanceof Error ? error.message : String(error);
      return structuredClone(request);
    }
  }

  reconcileResult(request) {
    const result = this.reconcile(structuredClone(request.order), request.exchangeOrderId);
    if (!result || typeof result.confirmed !== "boolean") {
      throw new Error("invalid reconciliation response");
    }
    return result;
  }

  get(clientRequestId) {
    const request = this.requests.get(clientRequestId);
    return request ? structuredClone(request) : null;
  }

  validateRequest(clientRequestId, order) {
    if (!clientRequestId || typeof clientRequestId !== "string") {
      throw new Error("invalid client request id");
    }
    if (!order || typeof order !== "object" || !order.symbol || !order.side || !Number.isFinite(order.quantity) || order.quantity <= 0) {
      throw new Error("invalid order");
    }
  }

  require(clientRequestId) {
    const request = this.requests.get(clientRequestId);
    if (!request) throw new Error(`unknown client request: ${clientRequestId}`);
    return request;
  }
}
