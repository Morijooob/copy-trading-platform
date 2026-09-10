import assert from "node:assert/strict";
import { ProductionSecurityGate } from "../src/production-security-gate.js";

const all = {
  backendOnlyExecution: true,
  authenticatedSessions: true,
  secureCookies: true,
  twoFactorForRealTrading: true,
  serverSideSecretStore: true,
  withdrawalsDisabled: true,
  killSwitch: true,
  riskLimits: true,
  idempotency: true,
  auditIntegrity: true,
  monitoringAndAlerts: true
};

const blocked = new ProductionSecurityGate();
assert.equal(blocked.evaluate().readyForRealMoney, false);
assert.ok(blocked.evaluate().failedControls.length > 0);
assert.throws(() => blocked.assertReadyForRealMoney(), /real-money trading blocked/);

const almost = new ProductionSecurityGate({ ...all, serverSideSecretStore: false });
assert.equal(almost.publicState().readyForRealMoney, false);
assert.deepEqual(almost.evaluate().failedControls, ["serverSideSecretStore"]);

const ready = new ProductionSecurityGate(all);
assert.equal(ready.evaluate().readyForRealMoney, true);
assert.equal(ready.assertReadyForRealMoney(), true);
assert.deepEqual(ready.publicState().failedControls, []);

console.log("Production Security Gate: ALL TESTS PASSED");
