import { ProductionSecurityGate } from '../production-security-gate.js';
import { CommissionEngine } from './commission.js';
import { OperationalSafety } from './operational-safety.js';

export class RealTradingService {
  constructor({ security = {}, safety = {}, commissionRateBps = 500, exchange } = {}) {
    this.gate = new ProductionSecurityGate(security);
    this.safety = new OperationalSafety(safety);
    this.commission = new CommissionEngine({ rateBps: commissionRateBps });
    this.exchange = exchange;
    this.seen = new Set();
  }

  state() {
    return {
      ...this.gate.publicState(),
      safety: this.safety.publicState(),
      commission: this.commission.publicState(),
      realExecution: false
    };
  }

  async copyMasterOrder({ idempotencyKey, follower, order, dailyLoss = 0, exposure = 0 } = {}) {
    if (!idempotencyKey) throw new Error('idempotencyKey required');
    if (this.seen.has(idempotencyKey)) return { duplicate: true };
    this.gate.assertReadyForRealMoney();
    if (!this.exchange) throw new Error('exchange adapter not configured');
    if (!follower?.id) throw new Error('follower required');
    if (!order?.symbol || !['buy', 'sell'].includes(order.side)) throw new Error('invalid order');
    if (!(Number.isFinite(order.quantity) && order.quantity > 0 && Number.isFinite(order.price) && order.price > 0)) {
      throw new Error('invalid order quantity/price');
    }

    const safety = this.safety.assertExecutionAllowed({
      notional: order.quantity * order.price,
      dailyLoss,
      exposure
    });
    if (!safety.allowed) {
      this.safety.recordAlert('EXECUTION_BLOCKED', safety.failedChecks.join(','));
      throw new Error(`execution blocked: ${safety.failedChecks.join(',')}`);
    }

    this.seen.add(idempotencyKey);
    try {
      const result = await this.exchange.order(order);
      return { duplicate: false, followerId: follower.id, exchangeOrder: result };
    } catch (error) {
      this.seen.delete(idempotencyKey);
      throw error;
    }
  }

  commissionForProfit(profit) {
    return this.commission.calculate(profit);
  }
}
