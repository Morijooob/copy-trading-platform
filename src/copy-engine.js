import { COPY_TRADING_MODES, assertCopyTradingMode } from './copy-trading-mode.js';
import { assertMasterCanPublish, assertSubscriptionCanCopy } from './master-follower.js';
import { createCopySignal } from './copy-signal.js';

function requireMap(value, field) {
  if (!(value instanceof Map)) throw new Error(`${field} must be a Map`);
  return value;
}

export function createCopyEngine({ processedKeys = new Set() } = {}) {
  if (!(processedKeys instanceof Set)) throw new Error('processedKeys must be a Set');

  function planSignal({ master, signal, subscriptions, mode = COPY_TRADING_MODES.DEMO, liveExecutionEnabled = false, exchangeAdapter = null } = {}) {
    assertCopyTradingMode(mode);
    assertMasterCanPublish(master);
    requireMap(subscriptions, 'subscriptions');

    const normalizedSignal = createCopySignal(signal);
    if (normalizedSignal.masterId !== master.masterId) throw new Error('signal master does not match master profile');

    if (mode === COPY_TRADING_MODES.LIVE) {
      if (liveExecutionEnabled !== true) throw new Error('live execution is disabled');
      if (!exchangeAdapter || exchangeAdapter.mode !== 'LIVE' || typeof exchangeAdapter.submitOrder !== 'function') {
        throw new Error('LIVE copy execution requires an explicit LIVE exchange adapter');
      }
    } else if (exchangeAdapter !== null) {
      throw new Error('DEMO/PAPER copy execution must not require an exchange adapter');
    }

    const intents = [];
    for (const subscription of subscriptions.values()) {
      try {
        assertSubscriptionCanCopy(subscription);
      } catch {
        continue;
      }
      if (subscription.masterId !== master.masterId) continue;
      if (subscription.mode !== mode) continue;

      const idempotencyKey = `${normalizedSignal.signalId}:${subscription.followerId}`;
      if (processedKeys.has(idempotencyKey)) continue;

      const quantity = normalizedSignal.quantity * subscription.allocation;
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('planned copy quantity must be positive');

      intents.push(Object.freeze({
        idempotencyKey,
        signalId: normalizedSignal.signalId,
        followerId: subscription.followerId,
        masterId: master.masterId,
        mode,
        symbol: normalizedSignal.symbol,
        side: normalizedSignal.side,
        quantity,
        price: normalizedSignal.price,
        maxRiskPercent: subscription.maxRiskPercent,
        exchangeAdapter: mode === COPY_TRADING_MODES.LIVE ? exchangeAdapter : null
      }));
    }

    for (const intent of intents) processedKeys.add(intent.idempotencyKey);
    return Object.freeze(intents);
  }

  return Object.freeze({ planSignal, processedKeys });
}
