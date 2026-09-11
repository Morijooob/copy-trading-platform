import assert from "node:assert/strict";
import { fetchMarketCandles } from "../src/real/market-feed.js";

function candles(count = 60) {
  return Array.from({ length: count }, (_, i) => {
    const openTime = 1_700_000_000_000 + i * 60_000;
    const closeTime = openTime + 59_999;
    const price = 100 + i;
    return [openTime, String(price), String(price + 2), String(price - 1), String(price + 1), "1000", closeTime];
  });
}

const fakeFetch = async () => ({ ok: true, status: 200, async json() { return candles(); } });
const feed = await fetchMarketCandles({ symbol: "BTCUSDT", fetchImpl: fakeFetch });
assert.equal(feed.symbol, "BTCUSDT");
assert.equal(feed.candles.length, 60);
assert.equal(feed.closes.at(-1), 160);
assert.equal(feed.source, "binance-public");

await assert.rejects(() => fetchMarketCandles({ symbol: "bad-symbol!", fetchImpl: fakeFetch }), /invalid symbol/);
await assert.rejects(() => fetchMarketCandles({ symbol: "BTCUSDT", fetchImpl: async () => ({ ok: false, status: 503 }) }), /market feed http 503/);
await assert.rejects(() => fetchMarketCandles({ symbol: "BTCUSDT", fetchImpl: async () => ({ ok: true, status: 200, async json() { return []; } }) }), /malformed market response/);
await assert.rejects(() => fetchMarketCandles({ symbol: "BTCUSDT", timeoutMs: 5, fetchImpl: () => new Promise(() => {}) }), /market feed timeout/);

console.log("real-market-feed tests passed");
