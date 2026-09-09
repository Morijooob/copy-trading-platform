import { COPY_TRADING_MODES, assertCopyTradingMode } from './copy-trading-mode.js';

const MASTER_STATUSES = new Set(['ACTIVE', 'PAUSED', 'DISABLED']);
const SUBSCRIPTION_STATUSES = new Set(['ACTIVE', 'PAUSED', 'DISABLED']);

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
  return value.trim();
}

function requirePositiveNumber(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`);
  return value;
}

export function createMasterProfile({ masterId, name, strategy = 'UNSPECIFIED', riskProfile = 'STANDARD', status = 'ACTIVE' } = {}) {
  masterId = requireNonEmptyString(masterId, 'masterId');
  name = requireNonEmptyString(name, 'name');
  if (!MASTER_STATUSES.has(status)) throw new Error(`invalid master status: ${status}`);
  return Object.freeze({ masterId, name, strategy, riskProfile, status });
}

export function createFollowerSubscription({
  followerId,
  masterId,
  mode = COPY_TRADING_MODES.DEMO,
  allocation = 1,
  maxRiskPercent = 100,
  status = 'ACTIVE',
  liveExecutionEnabled = false,
  exchangeAdapter = null
} = {}) {
  followerId = requireNonEmptyString(followerId, 'followerId');
  masterId = requireNonEmptyString(masterId, 'masterId');
  assertCopyTradingMode(mode);
  requirePositiveNumber(allocation, 'allocation');
  if (!Number.isFinite(maxRiskPercent) || maxRiskPercent <= 0 || maxRiskPercent > 100) {
    throw new Error('maxRiskPercent must be between 0 and 100');
  }
  if (!SUBSCRIPTION_STATUSES.has(status)) throw new Error(`invalid subscription status: ${status}`);

  if (mode === COPY_TRADING_MODES.LIVE) {
    if (liveExecutionEnabled !== true) throw new Error('live execution is disabled');
    if (!exchangeAdapter || exchangeAdapter.mode !== 'LIVE' || typeof exchangeAdapter.submitOrder !== 'function') {
      throw new Error('LIVE subscription requires an explicit LIVE exchange adapter');
    }
  } else if (exchangeAdapter !== null) {
    throw new Error('DEMO/PAPER subscription must not require an exchange adapter');
  }

  return Object.freeze({
    followerId,
    masterId,
    mode,
    allocation,
    maxRiskPercent,
    status,
    liveExecutionEnabled: mode === COPY_TRADING_MODES.LIVE,
    exchangeAdapter: mode === COPY_TRADING_MODES.LIVE ? exchangeAdapter : null
  });
}

export function assertMasterCanPublish(master) {
  if (!master || master.status !== 'ACTIVE') throw new Error('master is not active');
  return true;
}

export function assertSubscriptionCanCopy(subscription) {
  if (!subscription || subscription.status !== 'ACTIVE') throw new Error('subscription is not active');
  return true;
}

export function subscriptionKey({ followerId, masterId }) {
  return `${requireNonEmptyString(followerId, 'followerId')}:${requireNonEmptyString(masterId, 'masterId')}`;
}

export function addSubscription(subscriptionMap, subscription) {
  if (!(subscriptionMap instanceof Map)) throw new Error('subscriptionMap must be a Map');
  const key = subscriptionKey(subscription);
  if (subscriptionMap.has(key)) throw new Error('follower is already subscribed to this master');
  subscriptionMap.set(key, subscription);
  return subscription;
}
