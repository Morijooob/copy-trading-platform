import { NetworkResilience } from "./network-resilience.js";
import { NetworkPersistenceStore } from "./network-persistence-store.js";

export class PersistentNetworkResilience extends NetworkResilience {
  constructor({ submit, reconcile, store = new NetworkPersistenceStore() }) {
    super({ submit, reconcile });
    if (!store || typeof store.load !== "function" || typeof store.save !== "function") {
      throw new Error("invalid persistence store");
    }
    this.store = store;
    this.restore();
  }

  restore() {
    const state = this.store.load();
    this.nextId = state.nextRequestId;
    this.requests = new Map(state.requests.map((request) => [request.clientRequestId, structuredClone(request)]));
  }

  persist() {
    this.store.save({ nextRequestId: this.nextId, requests: [...this.requests.values()] });
  }

  execute(input) {
    const existing = this.requests.get(input.clientRequestId);
    if (existing) return structuredClone(existing);
    const result = super.execute(input);
    this.persist();
    return result;
  }

  retry(clientRequestId) {
    const result = super.retry(clientRequestId);
    this.persist();
    return result;
  }

  recoverAfterRestart() {
    const recovered = [];
    for (const request of this.requests.values()) {
      if (request.status === "CONFIRMED") continue;

      const reconciliation = this.reconcileResult(request);
      if (reconciliation.confirmed === true) {
        request.status = "CONFIRMED";
        request.exchangeOrderId = reconciliation.exchangeOrderId ?? request.exchangeOrderId;
        request.filledQty = reconciliation.filledQty ?? request.filledQty ?? null;
        request.lastError = null;
        request.reconciled = true;
        recovered.push(structuredClone(request));
        continue;
      }

      // Explicitly unresolved at the exchange means the original request was not found.
      // It is safe to retry, but we still keep the request persisted and auditable.
      request.status = "UNKNOWN";
      request.reconciled = true;
      request.lastError = null;
      recovered.push(structuredClone(request));
    }
    this.persist();
    return recovered;
  }
}
