export class WithdrawalService {
  constructor({ wallet, enabled = false, provider = null, maxAmount = 100000, stateStore = null } = {}) {
    if (!wallet) throw new Error('wallet required');
    this.wallet = wallet;
    this.enabled = enabled;
    this.provider = provider;
    this.maxAmount = maxAmount;
    this.stateStore = stateStore;
    this.requests = new Map();
    this.idempotency = new Map();
    this.reserved = new Map();
    this.audit = [];
    this.sequence = 0;
    this.#restore();
  }

  availableBalance(userId, asset = 'USDT') {
    return this.wallet.balance(userId, asset) - this.#reservedFor(userId, asset);
  }

  request({ userId, asset = 'USDT', amount, destination, idempotencyKey }) {
    this.#validate(userId, asset, amount, destination, idempotencyKey);
    if (!this.enabled) throw new Error('withdrawals disabled');
    const existingId = this.idempotency.get(`${userId}:${idempotencyKey}`);
    if (existingId) return { ...this.requests.get(existingId), duplicate: true };
    if (this.availableBalance(userId, asset) < amount) throw new Error('insufficient available balance');
    if (amount > this.maxAmount) throw new Error('amount exceeds maximum');
    const id = `wd-${++this.sequence}`;
    const request = Object.freeze({ id, userId, asset, amount, destination, idempotencyKey, status: 'PENDING', providerReference: null, failureReason: null, createdAt: new Date().toISOString() });
    this.requests.set(id, request);
    this.idempotency.set(`${userId}:${idempotencyKey}`, id);
    this.#reserve(request);
    this.#audit('requested', request);
    this.#persist();
    return { ...request, duplicate: false };
  }

  process(id) {
    const request = this.#require(id);
    if (request.status !== 'PENDING') throw new Error(`invalid transition from ${request.status}`);
    if (!this.enabled) throw new Error('withdrawals disabled');
    if (!this.provider || typeof this.provider.send !== 'function') throw new Error('withdrawal provider unavailable');
    this.#replace(request, { status: 'PROCESSING' });
    this.#audit('processing', this.requests.get(id));
    this.#persist();
    try {
      const result = this.provider.send({ ...request });
      if (!result || !result.reference) throw new Error('provider reference required');
      this.#replace(this.requests.get(id), { status: 'COMPLETED', providerReference: result.reference });
      this.#release(request);
      this.wallet.debit(request.userId, request.asset, request.amount, `withdrawal:${id}`);
      this.#audit('completed', this.requests.get(id));
      this.#persist();
      return this.requests.get(id);
    } catch (error) {
      this.#replace(this.requests.get(id), { status: 'RECONCILIATION_REQUIRED', failureReason: error instanceof Error ? error.message : String(error) });
      this.#audit('reconciliation_required', this.requests.get(id));
      this.#persist();
      return this.requests.get(id);
    }
  }

  reconcile(id, { outcome, providerReference = null } = {}) {
    const request = this.#require(id);
    if (request.status !== 'RECONCILIATION_REQUIRED') throw new Error(`invalid transition from ${request.status}`);
    if (outcome === 'COMPLETED') {
      if (!providerReference || typeof providerReference !== 'string') throw new Error('provider reference required');
      this.#replace(request, { status: 'COMPLETED', providerReference, failureReason: null });
      this.#release(request);
      this.wallet.debit(request.userId, request.asset, request.amount, `withdrawal:${id}`);
      this.#audit('reconciled_completed', this.requests.get(id));
    } else if (outcome === 'FAILED') {
      this.#replace(request, { status: 'FAILED', failureReason: request.failureReason || 'provider rejected' });
      this.#release(request);
      this.#audit('reconciled_failed', this.requests.get(id));
    } else throw new Error('invalid reconciliation outcome');
    this.#persist();
    return this.requests.get(id);
  }

  cancel(id) {
    const request = this.#require(id);
    if (request.status !== 'PENDING') throw new Error(`invalid transition from ${request.status}`);
    this.#replace(request, { status: 'CANCELLED' });
    this.#release(request);
    this.#audit('cancelled', this.requests.get(id));
    this.#persist();
    return this.requests.get(id);
  }

  get(id) { return this.requests.get(id) || null; }
  snapshot() { return { requests: [...this.requests.values()], reservations: [...this.reserved.entries()].map(([key, amount]) => ({ key, amount })), audit: [...this.audit] }; }

  #restore() {
    if (!this.stateStore || typeof this.stateStore.load !== 'function') return;
    const state = this.stateStore.load();
    if (!state) return;
    if (!Array.isArray(state.requests) || !Array.isArray(state.reservations) || !Array.isArray(state.audit)) throw new Error('invalid withdrawal persistence state');
    for (const request of state.requests) {
      if (!request || !request.id || !request.userId || !request.asset || !request.status) throw new Error('invalid persisted withdrawal');
      this.requests.set(request.id, Object.freeze({ ...request }));
      this.idempotency.set(`${request.userId}:${request.idempotencyKey}`, request.id);
      const match = /^wd-(\d+)$/.exec(request.id);
      if (match) this.sequence = Math.max(this.sequence, Number(match[1]));
    }
    for (const reservation of state.reservations) {
      if (!reservation || typeof reservation.key !== 'string' || !Number.isFinite(reservation.amount) || reservation.amount < 0) throw new Error('invalid persisted reservation');
      if (reservation.amount > 0) this.reserved.set(reservation.key, reservation.amount);
    }
    this.audit = state.audit.map(event => Object.freeze({ ...event }));
  }

  #persist() { if (!this.stateStore || typeof this.stateStore.save !== 'function') return; this.stateStore.save(this.snapshot()); }
  #validate(userId, asset, amount, destination, idempotencyKey) {
    if (!userId) throw new Error('userId required');
    if (!asset || !/^[A-Z0-9]{2,12}$/.test(asset)) throw new Error('invalid asset');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be positive');
    if (!Number.isFinite(this.maxAmount) || this.maxAmount <= 0) throw new Error('invalid maximum');
    if (!destination || typeof destination !== 'string' || destination.length > 256) throw new Error('invalid destination');
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length > 128) throw new Error('idempotency key required');
  }
  #require(id) { const request = this.requests.get(id); if (!request) throw new Error('withdrawal not found'); return request; }
  #key(request) { return `${request.userId}:${request.asset}`; }
  #reservedFor(userId, asset) { return this.reserved.get(`${userId}:${asset}`) || 0; }
  #reserve(request) { const key = this.#key(request); this.reserved.set(key, this.#reservedFor(request.userId, request.asset) + request.amount); }
  #release(request) { const key = this.#key(request); const next = this.#reservedFor(request.userId, request.asset) - request.amount; if (next <= 0) this.reserved.delete(key); else this.reserved.set(key, next); }
  #replace(request, patch) { this.requests.set(request.id, Object.freeze({ ...request, ...patch })); }
  #audit(event, request) { this.audit.push(Object.freeze({ event, withdrawalId: request.id, status: request.status, at: new Date().toISOString() })); }
}
