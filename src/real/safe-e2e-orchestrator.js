export class SafeE2EOrchestrator {
  constructor({ safety, exchange, audit = () => {} } = {}) {
    if (!safety) throw new Error('safety is required');
    this.safety = safety;
    this.exchange = exchange || { order: async () => { throw new Error('dry-run exchange must not place orders'); } };
    this.audit = audit;
    this.intents = new Map();
  }

  async execute({ idempotencyKey, followerId, masterId, order, dailyLoss = 0, exposure = 0 } = {}) {
    if (!idempotencyKey) throw new Error('idempotencyKey required');
    if (this.intents.has(idempotencyKey)) return { duplicate: true, intent: this.intents.get(idempotencyKey) };
    if (!followerId || !masterId) throw new Error('followerId and masterId required');
    if (!order?.symbol || !['buy', 'sell'].includes(order.side)) throw new Error('invalid order');
    if (!(Number.isFinite(order.quantity) && order.quantity > 0 && Number.isFinite(order.price) && order.price > 0)) {
      throw new Error('invalid order quantity/price');
    }

    const intent = {
      idempotencyKey,
      followerId,
      masterId,
      status: 'pending',
      order: { ...order },
      createdAt: new Date().toISOString()
    };
    this.intents.set(idempotencyKey, intent);
    this.audit({ type: 'EXECUTION_INTENT_CREATED', idempotencyKey, followerId, masterId });

    const safety = this.safety.assertExecutionAllowed({
      notional: order.quantity * order.price,
      dailyLoss,
      exposure
    });
    if (!safety.allowed) {
      intent.status = 'blocked';
      intent.reason = safety.failedChecks;
      this.safety.recordAlert('EXECUTION_BLOCKED', safety.failedChecks.join(','));
      this.audit({ type: 'EXECUTION_BLOCKED', idempotencyKey, reason: safety.failedChecks });
      return { duplicate: false, dryRun: true, executed: false, intent: { ...intent } };
    }

    // This phase is deliberately non-executing. It proves the complete control path
    // without ever calling an exchange order endpoint.
    intent.status = 'dry_run_approved';
    intent.dryRun = true;
    this.audit({ type: 'DRY_RUN_APPROVED', idempotencyKey, followerId, masterId });
    return { duplicate: false, dryRun: true, executed: false, intent: { ...intent } };
  }

  async recover(idempotencyKey) {
    const intent = this.intents.get(idempotencyKey);
    if (!intent) return { recovered: false, reason: 'intent_not_found' };
    if (intent.status === 'pending') {
      intent.status = 'recovery_required';
      this.audit({ type: 'EXECUTION_RECOVERY_REQUIRED', idempotencyKey });
    }
    return { recovered: true, intent: { ...intent } };
  }

  getIntent(idempotencyKey) {
    const intent = this.intents.get(idempotencyKey);
    return intent ? { ...intent } : null;
  }
}
