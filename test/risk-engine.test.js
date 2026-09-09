import assert from "node:assert/strict";
import { RiskEngine } from "../src/risk-engine.js";

const risk = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1500 });

assert.equal(risk.approve({ side: "BUY", quantity: 2, price: 100 }).approved, true);
assert.equal(risk.approve({ side: "BUY", quantity: 11, price: 100 }).approved, false);
assert.deepEqual(risk.approve({ side: "BUY", quantity: 11, price: 100 }).failedChecks, ["ORDER_NOTIONAL"]);

risk.setExposure(1400);
assert.deepEqual(risk.approve({ side: "BUY", quantity: 2, price: 100 }).failedChecks, ["MAX_EXPOSURE"]);

risk.recordRealizedPnl(-200);
assert.deepEqual(risk.approve({ side: "BUY", quantity: 1, price: 100 }).failedChecks, ["DAILY_LOSS"]);

risk.setKillSwitch(true, "test");
assert.equal(risk.approve({ side: "SELL", quantity: 1, price: 10 }).approved, false);
assert.ok(risk.approve({ side: "SELL", quantity: 1, price: 10 }).failedChecks.includes("KILL_SWITCH"));

assert.throws(() => risk.approve({ side: "BUY", quantity: 0, price: 100 }), /invalid quantity/);
assert.throws(() => risk.approve({ side: "HOLD", quantity: 1, price: 100 }), /invalid side/);
console.log("risk-engine tests: ok");
