import { RealDryRunPipeline } from './real-dry-run-pipeline.js';

/** Read-only preflight for an authenticated real user. Never places an order. */
export class RealUserPreflight {
  constructor({ securityGate, exchangeClient, marketFeed, userId, accountId, masterId = 1 } = {}) {
    this.securityGate = securityGate;
    this.exchangeClient = exchangeClient;
    this.marketFeed = marketFeed;
    this.userId = userId;
    this.accountId = accountId;
    this.masterId = masterId;
  }

  async run({ symbol = 'BTCUSDT' } = {}) {
    const failures = [];
    const checks = {};
    const security = this.securityGate?.evaluate?.() ?? { readyForRealMoney: false, failedControls: ['security_gate_missing'] };
    checks.security = security;
    if (!security.readyForRealMoney) failures.push(...security.failedControls.map((x) => `security:${x}`));
    if (!this.userId) failures.push('user:user_id_missing');
    if (!this.accountId) failures.push('exchange:account_id_missing');

    let account = null;
    if (this.userId && this.accountId && this.exchangeClient?.getAccount) {
      try {
        account = await this.exchangeClient.getAccount({ userId: this.userId, accountId: this.accountId });
        checks.exchange = { ok: true, state: account?.state ?? 'unknown', readOnly: true };
        if (account?.state !== 'verified') failures.push('exchange:account_not_verified');
        if (account?.withdrawPermission) failures.push('exchange:withdraw_permission_forbidden');
      } catch (error) {
        checks.exchange = { ok: false, readOnly: true };
        failures.push(`exchange:${error?.message || 'account_read_failed'}`);
      }
    } else {
      checks.exchange = { ok: false, readOnly: true };
      failures.push('exchange:read_only_account_client_missing');
    }

    let market = null;
    if (this.marketFeed?.fetch) {
      try {
        market = await this.marketFeed.fetch(symbol);
        checks.market = { ok: true, candleTime: market.candleTime, price: market.price, source: market.source };
      } catch (error) {
        checks.market = { ok: false };
        failures.push(`market:${error?.message || 'market_data_unavailable'}`);
      }
    } else {
      checks.market = { ok: false };
      failures.push('market:feed_missing');
    }

    let decision = null;
    if (market?.closes && market?.volumes && market.candleTime) {
      const pipeline = new RealDryRunPipeline({ masterId: this.masterId });
      decision = pipeline.cycle({ symbol, closes: market.closes, volumes: market.volumes, candleTime: market.candleTime, price: market.price });
      checks.strategy = { score: decision.score ?? null, signal: decision.signal ?? null, type: decision.type, dryRun: true };
    } else {
      failures.push('strategy:market_snapshot_invalid');
    }

    return Object.freeze({
      readyForRealMoney: failures.length === 0,
      readyForOrder: false,
      orderPlaced: false,
      dryRun: true,
      userId: this.userId ?? null,
      accountId: this.accountId ?? null,
      symbol,
      balance: account ? { available: account.available ?? null, currency: account.currency ?? null } : null,
      checks,
      failures,
      decision,
    });
  }
}
