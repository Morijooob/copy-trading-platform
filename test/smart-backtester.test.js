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

function regimeData() {
  const out = [];
  // Strong uptrend with controlled pullbacks. The gain/loss balance keeps RSI
  // inside the production confirmation band instead of saturating near 100.
  for (let i = 0; i < 180; i += 1) {
    const cycle = i % 6;
    out.push(cycle < 4 ? 0.0015 : -0.0020);
  }
  // Strong downtrend with controlled rebounds. RSI remains in the SHORT band.
  for (let i = 0; i < 120; i += 1) {
    const cycle = i % 6;
    out.push(cycle < 4 ? -0.0015 : 0.0020);
  }
  // Low-amplitude chop should not manufacture trades.
  for (let i = 0; i < 120; i += 1) out.push((i % 2 ? 1 : -1) * 0.00015);
  return candlesFromReturns(out);
}

const data = regimeData();
const result = backtest(data, { initialCapital: 1000 });
assert.ok(result.trades >= 1, 'backtester should produce trades on strong regimes');
assert.ok(Number.isFinite(result.finalEquity), 'final equity must be finite');
assert.ok(result.fees > 0, 'fees must be charged');
assert.ok(result.maxDrawdownPct >= 0 && result.maxDrawdownPct <= 100, 'drawdown must be bounded');
assert.equal(result.trades, result.wins + result.losses, 'trade accounting must balance');
assert.ok(result.trades.some((t) => t.side === 'LONG'), 'backtester should exercise LONG path');
assert.ok(result.trades.some((t) => t.side === 'SHORT'), 'backtester should exercise SHORT path');

const wf = walkForward(data, { trainRatio: 0.7, initialCapital: 1000 });
assert.equal(wf.ok, true);
assert.ok(wf.train && wf.test, 'walk-forward must return both partitions');
assert.ok(Number.isFinite(wf.test.finalEquity), 'out-of-sample equity must be finite');

const flat = backtest(candlesFromReturns(Array.from({ length: 180 }, () => 0)), { initialCapital: 1000 });
assert.equal(flat.trades, 0, 'flat market should not manufacture trades');
assert.equal(flat.finalEquity, 1000, 'no-trade capital must remain unchanged');

console.log('SMART BACKTESTER TESTS PASSED');
