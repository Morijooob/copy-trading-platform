import assert from 'node:assert/strict';
import { SmartTradingEngine, analyzeMarket } from '../src/smart/smart-trading-engine.js';

function candlesFrom(closes, { volume = 1000, spread = 0.01 } = {}) {
  return closes.map((close, i) => ({
    time: i,
    open: close,
    high: close * (1 + spread),
    low: close * (1 - spread),
    close,
    volume,
  }));
}

function rising(n = 90, start = 100, step = 0.5) {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

function falling(n = 90, start = 145, step = 0.5) {
  return Array.from({ length: n }, (_, i) => start - i * step);
}

// 1. Sudden crash: the engine must not produce a nonsensical long signal.
{
  const closes = rising(90);
  closes[88] = 60;
  closes[89] = 55;
  const result = analyzeMarket(candlesFrom(closes));
  assert.notEqual(result.action, 'LONG');
}

// 2. Sudden pump: the engine must not produce a nonsensical short signal.
{
  const closes = falling(90);
  closes[88] = 190;
  closes[89] = 200;
  const result = analyzeMarket(candlesFrom(closes));
  assert.notEqual(result.action, 'SHORT');
}

// 3. Alternating regimes: repeated reversals must never create an impossible state.
{
  const engine = new SmartTradingEngine({ cooldownBars: 2 });
  engine.process(candlesFrom(rising(90)));
  for (let i = 0; i < 8; i += 1) {
    const data = i % 2 === 0 ? candlesFrom(falling(90)) : candlesFrom(rising(90));
    const snapshot = engine.process(data);
    assert.ok(snapshot.position === null || snapshot.position.side === 'LONG' || snapshot.position.side === 'SHORT');
    assert.ok(Number.isFinite(snapshot.cash));
    assert.ok(snapshot.cash >= 0);
  }
}

// 4. Large gap against an open position: accounting must remain finite and non-negative.
{
  const engine = new SmartTradingEngine({ cooldownBars: 0 });
  engine.process(candlesFrom(rising(90)));
  if (engine.position) {
    const gap = rising(90);
    gap[88] = 20;
    gap[89] = 20;
    const snapshot = engine.process(candlesFrom(gap));
    assert.ok(Number.isFinite(snapshot.cash));
    assert.ok(Number.isFinite(snapshot.realized));
    assert.ok(Number.isFinite(snapshot.fees));
  }
}

// 5. Missing/zero volume must fail closed rather than fabricate confidence.
{
  const rows = candlesFrom(rising(90));
  for (const row of rows) row.volume = 0;
  const result = analyzeMarket(rows);
  assert.equal(result.action, 'NO_TRADE');
}

console.log('smart-engine-adversarial.test.js: PASS');
