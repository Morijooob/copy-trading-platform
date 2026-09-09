export class NetworkPersistenceStore {
  constructor(seed = null) {
    this.version = 1;
    this.state = seed === null ? { version: 1, nextRequestId: 1, requests: [] } : this.validate(seed);
  }

  save({ nextRequestId, requests }) {
    const next = {
      version: this.version,
      nextRequestId,
      requests: structuredClone(requests)
    };
    this.state = this.validate(next);
    return this.load();
  }

  load() {
    return structuredClone(this.state);
  }

  validate(state) {
    if (!state || state.version !== this.version) throw new Error("unsupported persistence version");
    if (!Number.isInteger(state.nextRequestId) || state.nextRequestId < 1) throw new Error("invalid next request id");
    if (!Array.isArray(state.requests)) throw new Error("invalid persisted requests");
    return structuredClone(state);
  }
}
