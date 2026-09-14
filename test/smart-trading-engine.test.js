import assert from 'node:assert/strict';
import { analyzeMarket, SmartTradingEngine, ema, rsi, atr, positionSize } from '../src/smart/smart-trading-engine.js';

function candlesFromCloses(closes, volume = 100) {
  return closes.map((close, i) => ({
    time: i,
    open: close * 0.999,
    high: close * 1.002,
    low: close * 0.998,
    close,
    volume
  }));
}

function rising(n = 100, start = 100, step = 1) {
  return candlesFromCloses(Array.from({ length: n }, (_, i) => start + i * step));
}

function falling(n = 100, start = 200, step = 1) {
  return candlesFromCloses(Array.from({ length: n }, (_, i) => start - i * step));
}

assert.equal(typeof ema([1, 2, 3, 4], 2), 'number');
assert.equal(typeof rsi([1, 2, 3, 4, 5, 6], 3), 'number');
assert.equal(typeof atr(rising(30), 14), 'number');

const longSignal = analyzeMarket(rising());
assert.equal(longSignal.action, 'LONG');
assert.ok(longSignal.score >= 72);
assert.ok(longSignal.stop < longSignal.price);
assert.ok(longSignal.target > longSignal.price);

const shortSignal = analyzeMarket(falling());
assert.equal(shortSignal.action, 'SHORT');
assert.ok(shortSignal.score >= 72);
assert.ok(shortSignal.stop > shortSignal.price);
assert.ok(shortSignal.target < shortSignal.price);

const noisy = candlesFromCloses(Array.from({ length: 100 }, (_, i) => 150 + (i % 2 ? 0.1 : -0.1)));
const noTrade = analyzeMarket(noisy);
assert.equal(noTrade.action, 'NO_TRADE');

const qty = positionSize({ equity: 1000, entry: 100, stop: 98, riskPerTradePct: 0.01 });
assert.equal(qty, 5);

const engine = new SmartTradingEngine({ capital: 1000 });
let snapshot = engine.process(rising());
assert.equal(snapshot.position?.side, 'LONG');
assert.ok(snapshot.position?.qty > 0);
assert.ok(snapshot.position?.stop < snapshot.position?.entry);

const events = engine.drainEvents();
assert.equal(events[0].type, 'OPEN');

// A confirmed reversal must close a LONG rather than silently flip it in the same bar.
snapshot = engine.process(falling());
assert.equal(snapshot.position, null);
assert.ok(engine.realized < 0 || engine.realized === 0);
assert.ok(engine.cooldown > 0);

console.log('smart-trading-engine.test.js: PASS');
