import assert from 'node:assert/strict';
import { DemoTradingEngine, signalFromRows } from '../src/demo/demo-trading-engine.js';

function rows(prices) {
  return prices.map((p, i) => [i, 0, 0, 0, p, 0]);
}
function market(price, baseline = 100) {
  // 20 historical closed candles at baseline, then the latest closed candle,
  // then the current market price used for execution/P&L marking.
  const prices = Array.from({ length: 20 }, () => baseline);
  prices.push(price, price);
  return rows(prices);
}

// Signal engine must reject insufficient data and return a usable price/signal.
assert.equal(signalFromRows(rows([100, 101])), null);
assert.equal(signalFromRows(market(101)).signal, 'BUY');
assert.equal(signalFromRows(market(99)).signal, 'SELL');

// Position P/L must use the position's own symbol, not whichever market ranks first.
const isolated = new DemoTradingEngine({ capital: 1000, config: { takeProfitPct: 0.99, stopLossPct: 0.99, maxHoldCycles: 99 } });
isolated.process({ ETHUSDT: market(100) });
const open = isolated.snapshot();
assert.equal(open.position.symbol, 'ETHUSDT');
isolated.process({ BTCUSDT: market(200), ETHUSDT: market(101) });
const marked = isolated.snapshot();
assert.ok(marked.unrealized > 0);
assert.equal(marked.position.symbol, 'ETHUSDT');
assert.equal(marked.lastPrices.ETHUSDT, 101);
assert.equal(marked.lastPrices.BTCUSDT, 200);

// Take-profit closes the position and records realized profit.
const tp = new DemoTradingEngine({ capital: 1000, config: { takeProfitPct: 0.01, stopLossPct: 0.5, maxHoldCycles: 99, cooldownCycles: 1 } });
tp.process({ ETHUSDT: market(100) });
tp.process({ ETHUSDT: market(102) });
assert.equal(tp.snapshot().position, null);
assert.ok(tp.snapshot().realized > 0);
assert.ok(tp.snapshot().fees > 0);
assert.ok(tp.drainEvents().some((e) => e.type === 'CLOSE' && e.reason === 'take-profit'));

// Stop-loss closes losing positions.
const sl = new DemoTradingEngine({ capital: 1000, config: { takeProfitPct: 0.5, stopLossPct: 0.01, maxHoldCycles: 99, cooldownCycles: 1 } });
sl.process({ ETHUSDT: market(100) });
sl.process({ ETHUSDT: market(98) });
assert.equal(sl.snapshot().position, null);
assert.ok(sl.snapshot().realized < 0);
assert.ok(sl.drainEvents().some((e) => e.type === 'CLOSE' && e.reason === 'stop-loss'));

// Reverse signal closes the old position; cooldown prevents instant churn/re-entry.
const reverse = new DemoTradingEngine({ capital: 1000, config: { takeProfitPct: 0.5, stopLossPct: 0.5, maxHoldCycles: 99, cooldownCycles: 1 } });
reverse.process({ ETHUSDT: market(100) });
reverse.process({ ETHUSDT: market(99) });
const reverseEvents = reverse.drainEvents();
assert.ok(reverseEvents.some((e) => e.type === 'CLOSE' && e.reason === 'reverse-signal'));
assert.equal(reverse.snapshot().position, null);
reverse.process({ ETHUSDT: market(99) });
assert.equal(reverse.snapshot().position, null);
reverse.process({ ETHUSDT: market(99) });
assert.equal(reverse.snapshot().position?.side, 'SHORT');

// Max-hold prevents an indefinite HOLD loop.
const maxHold = new DemoTradingEngine({ capital: 1000, config: { takeProfitPct: 0.5, stopLossPct: 0.5, maxHoldCycles: 3, cooldownCycles: 1 } });
maxHold.process({ ETHUSDT: market(100) });
maxHold.process({ ETHUSDT: market(100) });
maxHold.process({ ETHUSDT: market(100) });
maxHold.process({ ETHUSDT: market(100) });
assert.equal(maxHold.snapshot().position, null);
assert.ok(maxHold.drainEvents().some((e) => e.type === 'CLOSE' && e.reason === 'max-hold'));

// Repeated cycles can create multiple trades; the engine cannot get stuck on one position forever.
const multi = new DemoTradingEngine({ capital: 1000, config: { takeProfitPct: 0.01, stopLossPct: 0.5, maxHoldCycles: 4, cooldownCycles: 1 } });
for (const p of [100, 102, 99, 101, 98, 103]) multi.process({ ETHUSDT: market(p) });
assert.ok(multi.snapshot().orders >= 4);
assert.ok(multi.snapshot().fees > 0);

console.log('demo trading engine tests: ok');
