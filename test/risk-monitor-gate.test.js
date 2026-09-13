import assert from "node:assert/strict";
import { evaluateRuntimeRisk } from "../src/real/risk-monitor-gate.js";

const nowMs = Date.parse("2026-09-13T10:00:00.000Z");
const limits = { maxDailyLoss: 200, maxExposure: 1500, maxHeartbeatAgeSeconds: 60 };
const fresh = {
  as_of_date: "2026-09-13",
  daily_loss: 0,
  gross_exposure: 0,
  heartbeat_at: "2026-09-13T09:59:30.000Z",
  source: "test"
};

const healthy = evaluateRuntimeRisk({ ...limits, state: fresh, nowMs });
assert.equal(healthy.passed, true);
assert.deepEqual(healthy.failures, []);

const missing = evaluateRuntimeRisk({ ...limits, state: null, nowMs });
assert.equal(missing.passed, false);
assert.deepEqual(missing.failures, ["risk:telemetry_missing"]);

const stale = evaluateRuntimeRisk({
  ...limits,
  state: { ...fresh, heartbeat_at: "2026-09-13T09:58:59.000Z" },
  nowMs
});
assert.equal(stale.passed, false);
assert.ok(stale.failures.includes("risk:heartbeat_stale"));

const futureHeartbeat = evaluateRuntimeRisk({
  ...limits,
  state: { ...fresh, heartbeat_at: "2026-09-13T10:00:01.000Z" },
  nowMs
});
assert.equal(futureHeartbeat.passed, false);
assert.ok(futureHeartbeat.failures.includes("risk:heartbeat_invalid"));

const wrongDate = evaluateRuntimeRisk({
  ...limits,
  state: { ...fresh, as_of_date: "2026-09-12" },
  nowMs
});
assert.equal(wrongDate.passed, false);
assert.ok(wrongDate.failures.includes("risk:telemetry_date_mismatch"));

const lossExceeded = evaluateRuntimeRisk({
  ...limits,
  state: { ...fresh, daily_loss: 200.01 },
  nowMs
});
assert.equal(lossExceeded.passed, false);
assert.ok(lossExceeded.failures.includes("risk:max_daily_loss_exceeded"));

const exposureExceeded = evaluateRuntimeRisk({
  ...limits,
  state: { ...fresh, gross_exposure: 1500.01 },
  nowMs
});
assert.equal(exposureExceeded.passed, false);
assert.ok(exposureExceeded.failures.includes("risk:max_exposure_exceeded"));

const malformed = evaluateRuntimeRisk({
  ...limits,
  state: { ...fresh, daily_loss: "NaN", gross_exposure: -1 },
  nowMs
});
assert.equal(malformed.passed, false);
assert.ok(malformed.failures.includes("risk:daily_loss_unknown"));
assert.ok(malformed.failures.includes("risk:exposure_unknown"));

const invalidLimits = evaluateRuntimeRisk({
  state: fresh,
  maxDailyLoss: -1,
  maxExposure: "bad",
  maxHeartbeatAgeSeconds: 60,
  nowMs
});
assert.equal(invalidLimits.passed, false);
assert.ok(invalidLimits.failures.includes("risk:max_daily_loss_invalid"));
assert.ok(invalidLimits.failures.includes("risk:max_exposure_invalid"));

console.log("runtime risk gate torture tests passed");
