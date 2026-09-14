import assert from 'node:assert/strict';
import { analyzeMarket, SmartTradingEngine, positionSize } from '../src/smart/smart-trading-engine.js';

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

// Fail closed on missing, malformed, or non-positive market data.
assert.equal(analyzeMarket(null).action, 'NO_TRADE');
assert.equal(analyzeMarket([]).action, 'NO_TRADE');
assert.equal(analyzeMarket(rising(59)).action, 'NO_TRADE');
const malformed = rising();
malformed[malformed.length - 2].close = NaN;
assert.equal(analyzeMarket(malformed).action, 'NO_TRADE');

// Extreme volatility must never become a trade signal.
const volatile = rising().map((c, i) => ({
  ...c,
  high: c.close * (i % 2 ? 1.15 : 1.01),
  low: c.close * (i % 2 ? 0.85 : 0.99)
}));
assert.equal(analyzeMarket(volatile).action, 'NO_TRADE');

// Directional sizing must be deterministic and zero for invalid risk inputs.
assert.equal(positionSize({ equity: 1000, entry: 100, stop: 98, riskPerTradePct: 0.01 }), 5);
assert.equal(positionSize({ equity: 1000, entry: 100, stop: 100, riskPerTradePct: 0.01 }), 0);
assert.equal(positionSize({ equity: 0, entry: 100, stop: 98, riskPerTradePct: 0.01 }), 0);

// SHORT lifecycle: open, then close on target with fees included in realized P/L.
const engine = new SmartTradingEngine({ capital: 1000 });
let snapshot = engine.process(falling());
assert.equal(snapshot.position?.side, 'SHORT');
assert.ok(snapshot.position?.stop > snapshot.position?.entry);
assert.ok(snapshot.position?.target < snapshot.position?.entry);
const opened = engine.drainEvents();
assert.equal(opened[0].type, 'OPEN');

const short = engine.position;
const targetPrice = short.target;
engine.close(targetPrice, 'test-target');
assert.equal(engine.position, null);
assert.ok(engine.fees > 0);
assert.ok(Number.isFinite(engine.realized));
assert.ok(engine.cooldown > 0);

// A no-trade market must not open a position, even after cooldown expires.
const quiet = candlesFromCloses(Array.from({ length: 100 }, (_, i) => 150 + (i % 2 ? 0.1 : -0.1)));
const noTradeEngine = new SmartTradingEngine({ capital: 1000, config: { cooldownBars: 0 } });
const noTradeSnapshot = noTradeEngine.process(quiet);
assert.equal(noTradeSnapshot.signal.action, 'NO_TRADE');
assert.equal(noTradeSnapshot.position, null);

console.log('smart-trading-engine-hardening.test.js: PASS');
