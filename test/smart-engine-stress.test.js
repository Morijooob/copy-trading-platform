import assert from 'node:assert/strict';
import { SmartTradingEngine, analyzeMarket } from '../src/smart/smart-trading-engine.js';

function makeSeries(seed = 17, length = 140) {
  let state = seed >>> 0;
  let price = 100;
  const rows = [];
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const noise = ((state / 0xffffffff) - 0.5) * 2.2;
    const drift = i % 37 < 18 ? 0.65 : -0.65;
    const open = Math.max(1, price);
    price = Math.max(1, price + drift + noise);
    const close = price;
    const high = Math.max(open, close) + 0.35 + (i % 5) * 0.05;
    const low = Math.max(0.01, Math.min(open, close) - 0.35 - (i % 3) * 0.05);
    const volume = 900 + (i % 11) * 37 + Math.abs(noise) * 100;
    rows.push({ time: i, open, high, low, close, volume });
  }
  return rows;
}

// Run several deterministic market paths. Every state transition must stay finite,
// cash must never become negative, and a position must have valid protective geometry.
for (const seed of [1, 7, 17, 42, 99, 123456]) {
  const engine = new SmartTradingEngine({ capital: 1000, config: { cooldownBars: 2 } });
  const full = makeSeries(seed, 220);
  for (let end = 60; end <= full.length; end += 1) {
    const snapshot = engine.process(full.slice(0, end));
    assert.ok(Number.isFinite(snapshot.cash), `cash finite seed=${seed} bar=${end}`);
    assert.ok(Number.isFinite(snapshot.realized), `realized finite seed=${seed} bar=${end}`);
    assert.ok(Number.isFinite(snapshot.fees), `fees finite seed=${seed} bar=${end}`);
    assert.ok(snapshot.cash >= 0, `cash non-negative seed=${seed} bar=${end}`);
    assert.ok(snapshot.fees >= 0, `fees non-negative seed=${seed} bar=${end}`);
    if (snapshot.position) {
      assert.ok(snapshot.position.qty > 0);
      assert.ok(snapshot.position.entry > 0);
      assert.ok(snapshot.position.stop > 0);
      assert.ok(snapshot.position.target > 0);
      assert.ok(snapshot.position.side === 'LONG' || snapshot.position.side === 'SHORT');
      // A trailing stop may legitimately cross the entry after a profitable move.
      // The real geometry invariant is that it remains on the protective side of
      // the best observed price, while the target remains beyond the entry.
      if (snapshot.position.side === 'LONG') {
        assert.ok(snapshot.position.stop <= snapshot.position.bestPrice);
        assert.ok(snapshot.position.target > snapshot.position.entry);
      } else {
        assert.ok(snapshot.position.stop >= snapshot.position.bestPrice);
        assert.ok(snapshot.position.target < snapshot.position.entry);
      }
    }
  }
}

// Corrupt the latest closed candle repeatedly: analysis and the engine must fail closed.
for (const field of ['close', 'high', 'low', 'volume']) {
  const rows = makeSeries(77, 80);
  rows[78][field] = Number.NaN;
  const signal = analyzeMarket(rows);
  assert.equal(signal.action, 'NO_TRADE', `invalid ${field} must not trade`);
  const engine = new SmartTradingEngine({ capital: 1000 });
  const snapshot = engine.process(rows);
  assert.equal(snapshot.position, null, `invalid ${field} must not open`);
}

console.log('smart-engine-stress.test.js: PASS');
