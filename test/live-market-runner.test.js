import assert from 'node:assert/strict';
import { LiveMarketDryRun, fetchLiveCandles } from '../src/demo/live-market-runner.js';

const candle = (t, close, volume = 10) => [t, close - 1, close + 1, close - 0.5, close, volume];
const candles = Array.from({ length: 30 }, (_, i) => candle(1_700_000_000 + i * 60, 100 + i * 0.2, 10 + i));

const mockFetch = async () => ({ ok: true, status: 200, async json() { return candles; } });

const rows = await fetchLiveCandles('BTC-USD', mockFetch);
assert.equal(rows.length, 30);
assert.equal(rows.at(-1)[4], 105.8);
assert.equal(rows.at(-1)[5], 39);

let calls = 0;
const runner = new LiveMarketDryRun({
  capital: 100,
  fetchImpl: async (...args) => { calls += 1; return mockFetch(...args); }
});
const snapshot = await runner.safeTick();
assert.equal(calls, 3);
assert.equal(snapshot.cycleCount, 1);
assert.equal(snapshot.orders, 1);
assert.equal(snapshot.position?.side, 'LONG');
assert.equal(snapshot.position?.symbol, 'BTC');
assert.ok(snapshot.lastPrices.BTC > 0);

const failing = new LiveMarketDryRun({ capital: 100, fetchImpl: async () => ({ ok: false, status: 503 }) });
const safe = await failing.safeTick();
assert.equal(safe.orders, 0);
assert.equal(safe.position, null);
assert.equal(failing.lastError, 'LIVE_FEED_HTTP_503');

console.log('live-market-runner tests: PASS');
