import assert from "node:assert/strict";
import { RealExecutionPreflight } from "../src/real/real-execution-preflight.js";

const marketFeed = async () => ({
  price: 100000,
  candleTime: Date.now(),
  closes: Array.from({ length: 60 }, () => 100000),
  volumes: Array.from({ length: 60 }, () => 10)
});

const exirAdapter = {
  getBalance: async () => ({ balances: [{ currency: "USDT", available: 25 }] })
};

const riskLimits = { maxDailyLoss: 200, maxExposure: 1500, maxHeartbeatAgeSeconds: 60 };
const freshRiskMonitor = {
  getState: async () => ({
    as_of_date: new Date().toISOString().slice(0, 10),
    daily_loss: 0,
    gross_exposure: 0,
    heartbeat_at: new Date().toISOString(),
    source: "test"
  })
};

const ready = await new RealExecutionPreflight({
  securityGate: { evaluate: () => ({ readyForRealMoney: true, failedControls: [] }) },
  exirAdapter,
  marketFeed,
  riskMonitor: freshRiskMonitor,
  riskLimits,
  minimumAvailableBalance: 5
}).run();
assert.equal(ready.ready, true);
assert.equal(ready.orderPlacementAttempted, false);
assert.equal(ready.checks.every((check) => check.passed), true);

const blocked = await new RealExecutionPreflight({
  securityGate: { evaluate: () => ({ readyForRealMoney: false, failedControls: ["twoFactorForRealTrading"] }) },
  exirAdapter,
  marketFeed,
  riskMonitor: freshRiskMonitor,
  riskLimits,
  minimumAvailableBalance: 5
}).run();
assert.equal(blocked.ready, false);
assert.equal(blocked.checks.find((check) => check.name === "PRODUCTION_SECURITY_GATE").passed, false);
assert.equal(blocked.orderPlacementAttempted, false);

const staleRisk = await new RealExecutionPreflight({
  securityGate: { evaluate: () => ({ readyForRealMoney: true, failedControls: [] }) },
  exirAdapter,
  marketFeed,
  riskMonitor: { getState: async () => ({ as_of_date: new Date().toISOString().slice(0, 10), daily_loss: 0, gross_exposure: 0, heartbeat_at: new Date(Date.now() - 120000).toISOString(), source: "test" }) },
  riskLimits,
  minimumAvailableBalance: 5
}).run();
assert.equal(staleRisk.ready, false);
assert.match(staleRisk.checks.find((check) => check.name === "RUNTIME_RISK_GUARD").detail, /heartbeat_stale/);

const exceededRisk = await new RealExecutionPreflight({
  securityGate: { evaluate: () => ({ readyForRealMoney: true, failedControls: [] }) },
  exirAdapter,
  marketFeed,
  riskMonitor: { getState: async () => ({ as_of_date: new Date().toISOString().slice(0, 10), daily_loss: 201, gross_exposure: 1501, heartbeat_at: new Date().toISOString(), source: "test" }) },
  riskLimits,
  minimumAvailableBalance: 5
}).run();
assert.equal(exceededRisk.ready, false);
const riskDetail = exceededRisk.checks.find((check) => check.name === "RUNTIME_RISK_GUARD").detail;
assert.match(riskDetail, /max_daily_loss_exceeded/);
assert.match(riskDetail, /max_exposure_exceeded/);

const missingRisk = await new RealExecutionPreflight({
  securityGate: { evaluate: () => ({ readyForRealMoney: true, failedControls: [] }) },
  exirAdapter,
  marketFeed,
  minimumAvailableBalance: 5
}).run();
assert.equal(missingRisk.ready, false);
assert.match(missingRisk.checks.find((check) => check.name === "RUNTIME_RISK_GUARD").detail, /not configured/);

const noExir = await new RealExecutionPreflight({
  securityGate: { evaluate: () => ({ readyForRealMoney: true, failedControls: [] }) },
  marketFeed,
  riskMonitor: freshRiskMonitor,
  riskLimits
}).run();
assert.equal(noExir.ready, false);
assert.equal(noExir.checks.find((check) => check.name === "EXIR_READ_ONLY_HEALTH").passed, false);

const failedMarket = await new RealExecutionPreflight({
  securityGate: { evaluate: () => ({ readyForRealMoney: true, failedControls: [] }) },
  exirAdapter,
  marketFeed: async () => { throw new Error("market feed timeout"); },
  riskMonitor: freshRiskMonitor,
  riskLimits
}).run();
assert.equal(failedMarket.ready, false);
assert.match(failedMarket.checks.find((check) => check.name === "MARKET_DATA").detail, /timeout/);

console.log("real execution preflight tests passed");
