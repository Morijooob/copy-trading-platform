import assert from 'node:assert/strict';
import { backtest, walkForward } from '../src/smart/smart-backtester.js';

function candlesFromReturns(returns, start = 100) {
  let price = start;
  return returns.map((r, i) => {
    const open = price;
    price *= 1 + r;
    const close = price;
    const range = Math.max(0.001, Math.abs(close - open) * 1.8);
    return { time: i, open, high: Math.max(open, close) + range, low: Math.min(open, close) - range, close, volume: 100 + (i % 10) * 3 };
  });
}

const strong = [
  ...Array.from({ length: 180 }, (_, i) => (i % 6 < 4 ? 0.0015 : -0.0020)),
  ...Array.from({ length: 120 }, (_, i) => (i % 6 < 4 ? -0.0015 : 0.0020)),
  ...Array.from({ length: 120 }, (_, i) => (i % 2 ? 0.00015 : -0.00015))
];
const data = candlesFromReturns(strong);

const normal = backtest(data, { initialCapital: 1000 });
const noFee = backtest(data, { initialCapital: 1000, feeRate: 0, slippageBps: 0 });
assert.ok(normal.trades >= 1, 'strong regimes should produce trades');
assert.ok(Number.isFinite(normal.finalEquity), 'final equity must be finite');
assert.ok(normal.fees > 0, 'fees must be charged');
assert.ok(normal.maxDrawdownPct >= 0 && normal.maxDrawdownPct <= 100, 'drawdown must stay bounded');
assert.equal(normal.trades, normal.wins + normal.losses, 'trade accounting must balance');
assert.ok(normal.tradeDetails.some(t => t.side === 'LONG'), 'LONG path must be exercised');
assert.ok(normal.tradeDetails.some(t => t.side === 'SHORT'), 'SHORT path must be exercised');
assert.ok(normal.finalEquity <= noFee.finalEquity + 1e-9, 'fees/slippage must not improve the same replay');

const flat = backtest(candlesFromReturns(Array.from({ length: 180 }, () => 0)), { initialCapital: 1000 });
assert.equal(flat.trades, 0, 'flat market must not manufacture trades');
assert.equal(flat.finalEquity, 1000, 'no-trade capital must remain unchanged');

const malformed = data.map(c => ({ ...c }));
malformed[100].volume = Number.NaN;
const bad = backtest(malformed, { initialCapital: 1000 });
assert.equal(bad.ok, false);
assert.equal(bad.reason, 'invalid-candle-data');
assert.equal(bad.trades, 0);
assert.equal(bad.finalEquity, 1000);
assert.equal(backtest(null, { initialCapital: 1000 }).reason, 'invalid-candles');
assert.equal(backtest([], { initialCapital: 1000 }).reason, 'invalid-candles');

const wf = walkForward(data, { trainRatio: 0.7, initialCapital: 1000 });
assert.equal(wf.ok, true);
assert.ok(wf.train && wf.test, 'walk-forward must return train and out-of-sample partitions');
assert.ok(Number.isFinite(wf.test.finalEquity), 'out-of-sample equity must be finite');
assert.ok(wf.test.tradeDetails.every(t => t.entryBar >= 0 && t.exitBar >= t.entryBar), 'trade ledger bars must be ordered');

console.log('SMART BACKTESTER HARDENING TESTS PASSED');
