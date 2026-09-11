import assert from "node:assert/strict";
import { RealDryRunPipeline } from "../src/real/real-dry-run-pipeline.js";

function makeFeed() {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
  const volumes = Array.from({ length: 60 }, (_, i) => i === 59 ? 3000 : 1000);
  return { closes, volumes, candleTime: 1700000000000, price: closes.at(-1) };
}

let calls = 0;
const pipeline = new RealDryRunPipeline({
  marketFeed: async ({ symbol }) => {
    calls += 1;
    assert.equal(symbol, "BTCUSDT");
    return makeFeed();
  }
});

const first = await pipeline.cycleFromMarketFeed({ symbol: "BTCUSDT" });
assert.equal(calls, 1);
assert.equal(first.dryRun, true);
assert.ok(["BUY", "NO_TRADE"].includes(first.type));

const second = await pipeline.cycleFromMarketFeed({ symbol: "BTCUSDT" });
assert.equal(second.reason, "STALE_OR_DUPLICATE_CANDLE");

const unavailable = new RealDryRunPipeline({ marketFeed: async () => { throw new Error("timeout"); } });
const failed = await unavailable.cycleFromMarketFeed({ symbol: "ETHUSDT" });
assert.equal(failed.type, "NO_TRADE");
assert.equal(failed.reason, "MARKET_DATA_UNAVAILABLE");
assert.equal(failed.dryRun, true);

console.log("real-dry-run-market-feed tests passed");
