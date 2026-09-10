export class CommissionEngine {
  constructor({ rateBps = 500 } = {}) {
    if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
      throw new Error('commission rate must be 0..10000 bps');
    }
    this.rateBps = rateBps;
  }

  calculate(profit) {
    if (!Number.isFinite(profit) || profit < 0) return { grossProfit: 0, commission: 0, netProfit: Math.max(0, profit || 0) };
    const commission = Math.round((profit * this.rateBps) / 10000 * 1e8) / 1e8;
    return { grossProfit: profit, commission, netProfit: Math.round((profit - commission) * 1e8) / 1e8 };
  }

  publicState() {
    return { rateBps: this.rateBps, ratePercent: this.rateBps / 100 };
  }
}
