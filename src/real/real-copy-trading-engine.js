import { ExecutionEngine } from '../execution-engine.js';
import { RealTradingService } from './real-trading-service.js';
import { ExirClient } from './exir-client.js';

const TRUE = 'true';

/**
 * Production copy-trading execution bridge.
 *
 * The signal/risk/allocation layer stays exchange-agnostic. This class is the
 * final backend-only bridge that turns an approved follower order into an
 * exchange order. It is fail-closed: live execution is impossible unless the
 * production security controls, healthy monitoring heartbeat, and
 * REAL_COPY_TRADING_ENABLED are explicitly on.
 */
export class RealCopyTradingEngine {
  constructor({
    security = {},
    safety = {},
    exchange = null,
    exchangeResolver = null,
    exirClient = null,
    enableRealExecution = false,
    commissionRateBps = 500,
    execution = null,
    audit = () => {}
  } = {}) {
    this.service = new RealTradingService({
      security,
      safety,
      commissionRateBps,
      exchange,
      exchangeResolver,
      enableRealExecution
    });
    this.exchange = exchange || exirClient || null;
    this.exchangeResolver = exchangeResolver;
    this.execution = execution || new ExecutionEngine();
    this.audit = audit;
  }

  static fromEnv({ fetchImpl = fetch, audit = () => {}, exchangeResolver = null } = {}) {
    const security = {
      backendOnlyExecution: process.env.BACKEND_ONLY_EXECUTION === TRUE,
      authenticatedSessions: process.env.AUTHENTICATED_SESSIONS === TRUE,
      secureCookies: process.env.SECURE_COOKIES === TRUE,
      twoFactorForRealTrading: process.env.TWO_FACTOR_REAL_TRADING === TRUE,
      serverSideSecretStore: process.env.SERVER_SIDE_SECRET_STORE === TRUE,
      withdrawalsDisabled: process.env.WITHDRAWALS_DISABLED === TRUE,
      killSwitch: process.env.KILL_SWITCH === TRUE,
      riskLimits: process.env.RISK_LIMITS === TRUE,
      idempotency: process.env.IDEMPOTENCY === TRUE,
      auditIntegrity: process.env.AUDIT_INTEGRITY === TRUE,
      monitoringAndAlerts: process.env.MONITORING_ALERTS === TRUE
    };

    const hasCredentials = Boolean(process.env.EXIR_API_KEY && process.env.EXIR_API_SECRET);
    const exchange = hasCredentials
      ? new ExirClient({
          apiKey: process.env.EXIR_API_KEY,
          apiSecret: process.env.EXIR_API_SECRET,
          baseUrl: process.env.EXIR_API_BASE_URL || undefined,
          fetchImpl
        })
      : null;

    return new RealCopyTradingEngine({
      security,
      exchange: exchangeResolver ? null : exchange,
      exchangeResolver,
      enableRealExecution: process.env.REAL_COPY_TRADING_ENABLED === TRUE,
      audit
    });
  }

  status() {
    const serviceState = this.service.state();
    const monitoringHealthy = serviceState.safety.monitoringHealthy;
    const exchangeReady = Boolean(this.exchange) || typeof this.exchangeResolver === 'function';
    return {
      readyForRealMoney: serviceState.readyForRealMoney,
      realExecutionEnabled: serviceState.realExecution,
      exchangeConfigured: exchangeReady,
      followerExchangeIsolation: serviceState.followerExchangeIsolation,
      canPlaceOrders: serviceState.readyForRealMoney && serviceState.realExecution && exchangeReady && monitoringHealthy,
      failedControls: serviceState.failedControls,
      safety: serviceState.safety,
      commission: serviceState.commission
    };
  }

  async executeFollowerOrder({ idempotencyKey, masterId, follower, order, dailyLoss = 0, exposure = 0 } = {}) {
    if (!masterId) throw new Error('masterId required');
    if (!follower?.id) throw new Error('follower required');
    if (!idempotencyKey) throw new Error('idempotencyKey required');

    const result = await this.service.copyMasterOrder({
      idempotencyKey,
      follower,
      order,
      dailyLoss,
      exposure
    });

    this.audit({
      type: result.duplicate ? 'REAL_COPY_ORDER_DUPLICATE' : 'REAL_COPY_ORDER_SUBMITTED',
      idempotencyKey,
      masterId,
      followerId: follower.id,
      exchangeOrder: result.exchangeOrder || null
    });

    return result;
  }

  commissionForProfit(profit) {
    return this.service.commissionForProfit(profit);
  }
}
