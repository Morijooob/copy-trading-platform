import { ProductionSecurityGate } from '../production-security-gate.js';
import { CommissionEngine } from './commission.js';

export class RealTradingService {
  constructor({ security = {}, commissionRateBps = 500, exchange } = {}) {
    this.gate = new ProductionSecurityGate(security);
    this.commission = new CommissionEngine({ rateBps: commissionRateBps });
    this.exchange = exchange;
    this.seen = new Set();
  }

  state() {
    return { ...this.gate.publicState(), commission: this.commission.publicState(), realExecution: false };
  }

  async copyMasterOrder({ idempotencyKey, follower, order }) {
    if (!idempotencyKey) throw new Error('idempotencyKey required');
    if (this.seen.has(idempotencyKey)) return { duplicate: true };
    this.gate.assertReadyForRealMoney();
    if (!this.exchange) throw new Error('exchange adapter not configured');
    if (!follower?.id) throw new Error('follower required');
    if (!order?.symbol || !['buy', 'sell'].includes(order.side)) throw new Error('invalid order');
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
