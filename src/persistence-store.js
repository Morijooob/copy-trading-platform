export class PersistenceStore {
  constructor(seed = null) {
    this.version = 1;
    this.state = seed === null ? this.emptyState() : this.validateEnvelope(seed);
  }

  emptyState() {
    return {
      version: this.version,
      nextOrderId: 1,
      nextEventId: 1,
      orders: [],
      auditLog: []
    };
  }

  save({ nextOrderId, nextEventId, orders, auditLog }) {
    if (!Number.isInteger(nextOrderId) || nextOrderId < 1) throw new Error("invalid next order id");
    if (!Number.isInteger(nextEventId) || nextEventId < 1) throw new Error("invalid next event id");
    if (!Array.isArray(orders) || !Array.isArray(auditLog)) throw new Error("invalid persistence state");

    const envelope = {
      version: this.version,
      nextOrderId,
      nextEventId,
      orders: structuredClone(orders),
      auditLog: structuredClone(auditLog)
    };
    this.state = this.validateEnvelope(envelope);
    return this.snapshot();
  }

  load() {
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  validateEnvelope(envelope) {
    if (!envelope || envelope.version !== this.version) {
      throw new Error("unsupported persistence version");
    }
    if (!Number.isInteger(envelope.nextOrderId) || envelope.nextOrderId < 1) {
      throw new Error("invalid persisted next order id");
    }
    if (!Number.isInteger(envelope.nextEventId) || envelope.nextEventId < 1) {
      throw new Error("invalid persisted next event id");
    }
    if (!Array.isArray(envelope.orders) || !Array.isArray(envelope.auditLog)) {
      throw new Error("invalid persisted collections");
    }
    return structuredClone(envelope);
  }
}
