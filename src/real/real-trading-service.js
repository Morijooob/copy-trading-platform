import { ProductionSecurityGate } from '../production-security-gate.js';
import { CommissionEngine } from './commission.js';
import { OperationalSafety } from './operational-safety.js';

export class RealTradingService {
  constructor({ security = {}, safety = {}, commissionRateBps = 500, exchange, enableRealExecution = false } = {}) {
    this.gate = new ProductionSecurityGate(security);
    this.safety = new OperationalSafety(safety);
    this.commission = new CommissionEngine({ rateBps: commissionRateBps });
    this.exchange = exchange;
    this.enableRealExecution = enableRealExecution === true;
    this.seen = new Set();
    this.inFlight = new Map();
  }

  state() {
    return {
      ...this.gate.publicState(),
      safety: this.safety.publicState(),
      commission: this.commission.publicState(),
      realExecution: this.enableRealExecution
    };
  }

  async copyMasterOrder({ idempotencyKey, follower, order, dailyLoss = 0, exposure = 0 } = {}) {
    if (!idempotencyKey) throw new Error('idempotencyKey required');
    if (this.seen.has(idempotencyKey)) return { duplicate: true };
    if (this.inFlight.has(idempotencyKey)) {
      const result = await this.inFlight.get(idempotencyKey);
      return { duplicate: true, exchangeOrder: result.exchangeOrder || null };
    }

    this.gate.assertReadyForRealMoney();
    if (!this.enableRealExecution) throw new Error('real execution is explicitly disabled');
    if (!this.exchange) throw new Error('exchange adapter not configured');
    if (!follower?.id) throw new Error('follower required');
    if (!order?.symbol || !['buy', 'sell'].includes(order.side)) throw new Error('invalid order');
    if (!(Number.isFinite(order.quantity) && order.quantity > 0 && Number.isFinite(order.price) && order.price > 0)) {
      throw new Error('invalid order quantity/price');
    }

    if (!this.safety.monitoringHealthy()) {
      this.safety.recordAlert('EXECUTION_BLOCKED', 'MONITORING_HEARTBEAT_STALE');
      throw new Error('execution blocked: MONITORING_HEARTBEAT_STALE');
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

    const executionPromise = (async () => {
      try {
        const result = await this.exchange.order(order);
        this.seen.add(idempotencyKey);
        return { duplicate: false, followerId: follower.id, exchangeOrder: result };
      } finally {
        this.inFlight.delete(idempotencyKey);
      }
    })();

    this.inFlight.set(idempotencyKey, executionPromise);
    return executionPromise;
  }

  commissionForProfit(profit) {
    return this.commission.calculate(profit);
  }
}
