import assert from "node:assert/strict";
import { RealDryRunPipeline, scoreMarket } from "../src/real/real-dry-run-pipeline.js";

const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 0.8);
const volumes = Array.from({ length: 40 }, (_, i) => 1000 + (i % 5) * 20);

{
  const market = scoreMarket({ symbol: "BTCUSDT", closes, volumes, fast: 9, slow: 21 });
  assert.equal(market.sig, "BUY");
  assert.ok(market.score >= 0 && market.score <= 100);
  assert.equal(typeof market.trend, "number");
  assert.equal(typeof market.liquidity, "number");
  assert.equal(typeof market.volatility, "number");
}

{
  const pipeline = new RealDryRunPipeline({ masterId: 1 });
  const first = pipeline.cycle({ symbol: "BTCUSDT", closes, volumes, candleTime: 100, price: 120 });
  assert.equal(first.dryRun, true);
  assert.equal(first.type, "BUY");
  assert.equal(pipeline.getState().positions.BTCUSDT > 0, true);

  const duplicate = pipeline.cycle({ symbol: "BTCUSDT", closes, volumes, candleTime: 100, price: 120 });
  assert.equal(duplicate.reason, "STALE_OR_DUPLICATE_CANDLE");
}

{
  const pipeline = new RealDryRunPipeline({ masterId: 1 });
  const lowScoreCloses = Array.from({ length: 40 }, () => 100);
  const result = pipeline.cycle({ symbol: "BTCUSDT", closes: lowScoreCloses, volumes, candleTime: 200, price: 100 });
  assert.equal(result.type, "NO_TRADE");
  assert.equal(result.reason, "MARKET_SCORE_BELOW_25");
}

{
  const pipeline = new RealDryRunPipeline({ masterId: 1, riskLimits: { maxOrderNotional: 1 } });
  const result = pipeline.cycle({ symbol: "BTCUSDT", closes, volumes, candleTime: 300, price: 120 });
  assert.equal(result.type, "NO_TRADE");
  assert.equal(result.reason, "RISK_CHECK_FAILED");
  assert.ok(result.failedChecks.includes("ORDER_NOTIONAL"));
}

{
  const pipeline = new RealDryRunPipeline({ masterId: 1 });
  const result = pipeline.cycle({ symbol: "BTCUSDT", closes, volumes, candleTime: 400, price: 120 });
  assert.equal(result.type, "BUY");
  assert.equal(pipeline.getState().audit.length, 1);
  assert.equal(pipeline.getState().dryRun, true);
}

console.log("real-dry-run-pipeline tests: ok");
