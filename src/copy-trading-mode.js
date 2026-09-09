export const COPY_TRADING_MODES = Object.freeze({
  DEMO: 'DEMO',
  PAPER: 'PAPER',
  LIVE: 'LIVE'
});

const VALID_MODES = new Set(Object.values(COPY_TRADING_MODES));

export function assertCopyTradingMode(mode) {
  if (!VALID_MODES.has(mode)) throw new Error(`invalid copy trading mode: ${mode}`);
  return mode;
}

export function isRealMoneyMode(mode) {
  assertCopyTradingMode(mode);
  return mode === COPY_TRADING_MODES.LIVE;
}

export function buildExecutionPolicy({ mode = COPY_TRADING_MODES.DEMO, liveExecutionEnabled = false, exchangeAdapter = null } = {}) {
  assertCopyTradingMode(mode);

  if (mode !== COPY_TRADING_MODES.LIVE) {
    return Object.freeze({
      mode,
      realMoney: false,
      exchangeRequired: false,
      exchangeAdapter: null
    });
  }

  if (liveExecutionEnabled !== true) throw new Error('live execution is disabled');
  if (!exchangeAdapter || typeof exchangeAdapter.submitOrder !== 'function') throw new Error('live exchange adapter is required');
  if (exchangeAdapter.mode !== 'LIVE') throw new Error('live exchange adapter is not explicitly LIVE');

  return Object.freeze({
    mode,
    realMoney: true,
    exchangeRequired: true,
    exchangeAdapter
  });
}

export function assertNoLiveExecution(policy) {
  if (!policy || policy.realMoney !== false) throw new Error('live execution policy required');
  return true;
}
