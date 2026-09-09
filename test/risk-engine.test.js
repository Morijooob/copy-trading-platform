import assert from "node:assert/strict";
import { RiskEngine } from "../src/risk-engine.js";

const risk = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1500 });

assert.equal(risk.approve({ side: "BUY", quantity: 2, price: 100 }).approved, true);
assert.equal(risk.approve({ side: "BUY", quantity: 11, price: 100 }).approved, false);
assert.deepEqual(risk.approve({ side: "BUY", quantity: 11, price: 100 }).failedChecks, ["ORDER_NOTIONAL"]);

risk.setExposure(1400);
assert.deepEqual(risk.approve({ side: "BUY", quantity: 2, price: 100 }).failedChecks, ["MAX_EXPOSURE"]);

risk.recordRealizedPnl(-201);
assert.deepEqual(risk.approve({ side: "BUY", quantity: 1, price: 100 }).failedChecks, ["DAILY_LOSS"]);

risk.setKillSwitch(true, "test");
assert.equal(risk.approve({ side: "SELL", quantity: 1, price: 10 }).approved, false);
assert.ok(risk.approve({ side: "SELL", quantity: 1, price: 10 }).failedChecks.includes("KILL_SWITCH"));

assert.throws(() => risk.approve({ side: "BUY", quantity: 0, price: 100 }), /invalid quantity/);
assert.throws(() => risk.approve({ side: "HOLD", quantity: 1, price: 100 }), /invalid side/);

{
  const atomic = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1500 });
  const first = atomic.reserve({ side: "BUY", quantity: 10, price: 100 });
  assert.equal(first.approved, true);
  assert.equal(atomic.reservedExposure, 1000);

  const second = atomic.reserve({ side: "BUY", quantity: 6, price: 100 });
  assert.equal(second.approved, false);
  assert.deepEqual(second.failedChecks, ["MAX_EXPOSURE"]);

  atomic.commitReservation(first.reservationId);
  assert.equal(atomic.reservedExposure, 0);
  assert.equal(atomic.exposure, 1000);

  assert.throws(() => atomic.commitReservation(first.reservationId), /reservation is committed/);
}

{
  const atomic = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1500 });
  const first = atomic.reserve({ side: "BUY", quantity: 10, price: 100 });
  assert.equal(first.approved, true);
  atomic.releaseReservation(first.reservationId);
  assert.equal(atomic.reservedExposure, 0);
  assert.equal(atomic.exposure, 0);

  const second = atomic.reserve({ side: "BUY", quantity: 10, price: 100 });
  assert.equal(second.approved, true);
}

console.log("risk-engine tests: ok");
