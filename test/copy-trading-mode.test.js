import test from 'node:test';
import assert from 'node:assert/strict';
import { COPY_TRADING_MODES, assertCopyTradingMode, buildExecutionPolicy, isRealMoneyMode, assertNoLiveExecution } from '../src/copy-trading-mode.js';

test('demo and paper modes never require an exchange adapter', () => {
  for (const mode of [COPY_TRADING_MODES.DEMO, COPY_TRADING_MODES.PAPER]) {
    const policy = buildExecutionPolicy({ mode });
    assert.equal(policy.mode, mode);
    assert.equal(policy.realMoney, false);
    assert.equal(policy.exchangeRequired, false);
    assert.equal(policy.exchangeAdapter, null);
    assert.equal(isRealMoneyMode(mode), false);
    assertNoLiveExecution(policy);
  }
});

test('live mode fails closed unless explicitly enabled with a LIVE adapter', () => {
  assert.throws(() => buildExecutionPolicy({ mode: COPY_TRADING_MODES.LIVE }), /live execution is disabled/);
  assert.throws(() => buildExecutionPolicy({ mode: COPY_TRADING_MODES.LIVE, liveExecutionEnabled: true }), /live exchange adapter is required/);
  assert.throws(() => buildExecutionPolicy({
    mode: COPY_TRADING_MODES.LIVE,
    liveExecutionEnabled: true,
    exchangeAdapter: { mode: 'SANDBOX', submitOrder() {} }
  }), /not explicitly LIVE/);

  const adapter = { mode: 'LIVE', submitOrder() {} };
  const policy = buildExecutionPolicy({ mode: COPY_TRADING_MODES.LIVE, liveExecutionEnabled: true, exchangeAdapter: adapter });
  assert.equal(policy.realMoney, true);
  assert.equal(policy.exchangeRequired, true);
  assert.equal(policy.exchangeAdapter, adapter);
  assert.equal(isRealMoneyMode(COPY_TRADING_MODES.LIVE), true);
  assert.throws(() => assertNoLiveExecution(policy), /live execution policy required/);
});

test('mode validation is strict', () => {
  assert.equal(assertCopyTradingMode(COPY_TRADING_MODES.DEMO), COPY_TRADING_MODES.DEMO);
  assert.throws(() => assertCopyTradingMode('TEST'), /invalid copy trading mode/);
});
