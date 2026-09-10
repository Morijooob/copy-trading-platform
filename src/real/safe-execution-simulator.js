const SCENARIOS = Object.freeze(['crash', 'timeout', 'partial_fill', 'recovery']);

export class SafeExecutionSimulator {
  constructor({ audit = () => {} } = {}) {
    this.audit = audit;
    this.intents = new Map();
  }

  async run({ idempotencyKey, followerId, masterId, order, scenario = 'recovery' } = {}) {
    if (!idempotencyKey) throw new Error('idempotencyKey required');
    if (!followerId || !masterId) throw new Error('followerId and masterId required');
    if (!order?.symbol || !['buy', 'sell'].includes(order.side)) throw new Error('invalid order');
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) throw new Error('invalid order quantity');
    if (!SCENARIOS.includes(scenario)) throw new Error('unsupported scenario');
    if (this.intents.has(idempotencyKey)) return { duplicate: true, intent: { ...this.intents.get(idempotencyKey) } };

    const intent = {
      idempotencyKey,
      followerId,
      masterId,
      scenario,
      status: 'pending',
      filledQuantity: 0,
      remainingQuantity: order.quantity,
      createdAt: new Date().toISOString()
    };
    this.intents.set(idempotencyKey, intent);
    this.audit({ type: 'SIM_INTENT_CREATED', idempotencyKey, scenario });

    if (scenario === 'crash') {
      intent.status = 'unknown_after_crash';
      this.audit({ type: 'SIM_CRASH', idempotencyKey });
      return { simulated: true, externalOrderPlaced: false, intent: { ...intent } };
    }

    if (scenario === 'timeout') {
      intent.status = 'timeout';
      this.audit({ type: 'SIM_TIMEOUT', idempotencyKey });
      return { simulated: true, externalOrderPlaced: false, intent: { ...intent } };
    }

    if (scenario === 'partial_fill') {
      intent.filledQuantity = Number((order.quantity / 2).toFixed(12));
      intent.remainingQuantity = Number((order.quantity - intent.filledQuantity).toFixed(12));
      intent.status = 'partial';
      this.audit({ type: 'SIM_PARTIAL_FILL', idempotencyKey, filledQuantity: intent.filledQuantity });
      return { simulated: true, externalOrderPlaced: false, intent: { ...intent } };
    }

    intent.filledQuantity = order.quantity;
    intent.remainingQuantity = 0;
    intent.status = 'filled';
    this.audit({ type: 'SIM_RECOVERY_COMPLETE', idempotencyKey });
    return { simulated: true, externalOrderPlaced: false, intent: { ...intent } };
  }

  recover(idempotencyKey) {
    const intent = this.intents.get(idempotencyKey);
    if (!intent) return { recovered: false, reason: 'intent_not_found' };
    if (intent.status === 'unknown_after_crash' || intent.status === 'timeout') {
      intent.status = 'recovery_required';
      this.audit({ type: 'SIM_RECOVERY_REQUIRED', idempotencyKey });
    } else if (intent.status === 'partial') {
      intent.status = 'partial_recovery_required';
      this.audit({ type: 'SIM_PARTIAL_RECOVERY_REQUIRED', idempotencyKey });
    }
    return { recovered: true, intent: { ...intent } };
  }

  getIntent(idempotencyKey) {
    const intent = this.intents.get(idempotencyKey);
    return intent ? { ...intent } : null;
  }
}

export { SCENARIOS };
