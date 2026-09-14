export class WithdrawalService {
  constructor({ wallet, enabled = false, provider = null, maxAmount = 100000 } = {}) {
    if (!wallet) throw new Error('wallet required');
    this.wallet = wallet;
    this.enabled = enabled;
    this.provider = provider;
    this.maxAmount = maxAmount;
    this.requests = new Map();
    this.idempotency = new Map();
    this.reserved = new Map();
    this.audit = [];
    this.sequence = 0;
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

    const id = `wd-${++this.sequence}`;
    const request = Object.freeze({
      id,
      userId,
      asset,
      amount,
      destination,
      idempotencyKey,
      status: 'PENDING',
      providerReference: null,
      failureReason: null,
      createdAt: new Date().toISOString()
    });
    this.requests.set(id, request);
    this.idempotency.set(`${userId}:${idempotencyKey}`, id);
    this.#reserve(request);
    this.#audit('requested', request);
    return { ...request, duplicate: false };
  }

  process(id) {
    const request = this.#require(id);
    if (request.status !== 'PENDING') throw new Error(`invalid transition from ${request.status}`);
    if (!this.enabled) throw new Error('withdrawals disabled');
    if (!this.provider || typeof this.provider.send !== 'function') throw new Error('withdrawal provider unavailable');

    this.#replace(request, { status: 'PROCESSING' });
    this.#audit('processing', this.requests.get(id));

    try {
      const result = this.provider.send({ ...request });
      if (!result || !result.reference) throw new Error('provider reference required');
      this.#replace(this.requests.get(id), { status: 'COMPLETED', providerReference: result.reference });
      this.#release(request);
      this.wallet.debit(request.userId, request.asset, request.amount, `withdrawal:${id}`);
      this.#audit('completed', this.requests.get(id));
      return this.requests.get(id);
    } catch (error) {
      this.#replace(this.requests.get(id), { status: 'FAILED', failureReason: error.message });
      this.#release(request);
      this.#audit('failed', this.requests.get(id));
      return this.requests.get(id);
    }
  }

  cancel(id) {
    const request = this.#require(id);
    if (request.status !== 'PENDING') throw new Error(`invalid transition from ${request.status}`);
    this.#replace(request, { status: 'CANCELLED' });
    this.#release(request);
    this.#audit('cancelled', this.requests.get(id));
    return this.requests.get(id);
  }

  get(id) {
    return this.requests.get(id) || null;
  }

  snapshot() {
    return {
      requests: [...this.requests.values()],
      reservations: [...this.reserved.entries()].map(([key, amount]) => ({ key, amount })),
      audit: [...this.audit]
    };
  }

  #validate(userId, asset, amount, destination, idempotencyKey) {
    if (!userId) throw new Error('userId required');
    if (!asset || !/^[A-Z0-9]{2,12}$/.test(asset)) throw new Error('invalid asset');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be positive');
    if (amount > this.maxAmount) throw new Error('amount exceeds maximum');
    if (!destination || typeof destination !== 'string' || destination.length > 256) throw new Error('invalid destination');
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length > 128) throw new Error('idempotency key required');
  }

  #require(id) {
    const request = this.requests.get(id);
    if (!request) throw new Error('withdrawal not found');
    return request;
  }

  #key(request) {
    return `${request.userId}:${request.asset}`;
  }

  #reservedFor(userId, asset) {
    return this.reserved.get(`${userId}:${asset}`) || 0;
  }

  #reserve(request) {
    const key = this.#key(request);
    this.reserved.set(key, this.#reservedFor(request.userId, request.asset) + request.amount);
  }

  #release(request) {
    const key = this.#key(request);
    const next = this.#reservedFor(request.userId, request.asset) - request.amount;
    if (next <= 0) this.reserved.delete(key);
    else this.reserved.set(key, next);
  }

  #replace(request, patch) {
    const next = Object.freeze({ ...request, ...patch });
    this.requests.set(request.id, next);
  }

  #audit(event, request) {
    this.audit.push(Object.freeze({ event, withdrawalId: request.id, status: request.status, at: new Date().toISOString() }));
  }
}
