import assert from "node:assert/strict";
import { RealExecutionPreflight } from "../src/real/real-execution-preflight.js";

const allEnabled = Object.fromEntries([
  "backendOnlyExecution",
  "authenticatedSessions",
  "secureCookies",
  "twoFactorForRealTrading",
  "serverSideSecretStore",
  "withdrawalsDisabled",
  "killSwitch",
  "riskLimits",
  "idempotency",
  "auditIntegrity",
  "monitoringAndAlerts"
].map((key) => [key, true]));

const marketFeed = async () => ({
  price: 100000,
  candleTime: Date.now(),
  closes: Array.from({ length: 60 }, () => 100000),
  volumes: Array.from({ length: 60 }, () => 10)
});

const exirAdapter = {
  getBalance: async () => ({ balances: [{ currency: "USDT", available: 25 }] })
};

const ready = await new RealExecutionPreflight({
  securityGate: { evaluate: () => ({ readyForRealMoney: true, failedControls: [] }) },
  exirAdapter,
  marketFeed,
  minimumAvailableBalance: 5
}).run();
assert.equal(ready.ready, true);
assert.equal(ready.orderPlacementAttempted, false);
assert.equal(ready.checks.every((check) => check.passed), true);

const blocked = await new RealExecutionPreflight({
  securityGate: { evaluate: () => ({ readyForRealMoney: false, failedControls: ["twoFactorForRealTrading"] }) },
  exirAdapter,
  marketFeed,
  minimumAvailableBalance: 5
}).run();
assert.equal(blocked.ready, false);
assert.equal(blocked.checks.find((check) => check.name === "PRODUCTION_SECURITY_GATE").passed, false);
assert.equal(blocked.orderPlacementAttempted, false);

const noExir = await new RealExecutionPreflight({
  securityGate: { evaluate: () => ({ readyForRealMoney: true, failedControls: [] }) },
  marketFeed
}).run();
assert.equal(noExir.ready, false);
assert.equal(noExir.checks.find((check) => check.name === "EXIR_READ_ONLY_HEALTH").passed, false);

const failedMarket = await new RealExecutionPreflight({
  securityGate: { evaluate: () => ({ readyForRealMoney: true, failedControls: [] }) },
  exirAdapter,
  marketFeed: async () => { throw new Error("market feed timeout"); }
}).run();
assert.equal(failedMarket.ready, false);
assert.match(failedMarket.checks.find((check) => check.name === "MARKET_DATA").detail, /timeout/);

console.log("real execution preflight tests passed");
