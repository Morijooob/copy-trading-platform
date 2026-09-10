import assert from "node:assert/strict";
import { OperationalSafety } from "../src/real/operational-safety.js";

{
  const safety = new OperationalSafety();
  assert.equal(safety.assertExecutionAllowed({ notional: 100, dailyLoss: 0, exposure: 100 }).allowed, true);
  assert.equal(safety.monitoringHealthy(), false);
  safety.heartbeat(1000);
  assert.equal(safety.monitoringHealthy(1000), true);
  assert.equal(safety.monitoringHealthy(61001), false);
}

{
  const safety = new OperationalSafety({ maxOrderNotional: 100 });
  const result = safety.assertExecutionAllowed({ notional: 101, dailyLoss: 0, exposure: 0 });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.failedChecks, ["ORDER_NOTIONAL"]);
}

{
  const safety = new OperationalSafety();
  safety.setKillSwitch(true, "manual emergency stop");
  const result = safety.assertExecutionAllowed({ notional: 1, dailyLoss: 0, exposure: 1 });
  assert.equal(result.allowed, false);
  assert.ok(result.failedChecks.includes("KILL_SWITCH"));
  assert.equal(safety.getAlerts()[0].type, "KILL_SWITCH_ENABLED");
  safety.setKillSwitch(false, "incident cleared");
  assert.equal(safety.assertExecutionAllowed({ notional: 1, dailyLoss: 0, exposure: 1 }).allowed, true);
}

{
  assert.throws(() => new OperationalSafety({ maxExposure: 0 }), /safety limit must be positive/);
}

console.log("operational-safety tests: ok");
