import assert from "node:assert/strict";
import { RealUserAccount, ACCOUNT_STATES } from "../src/real-user-account.js";

const test = (name, fn) => {
  try { fn(); console.log("PASS:", name); }
  catch (error) { console.error("FAIL:", name); throw error; }
};

const account = (permissions = {}) => new RealUserAccount({
  userId: "user-1", exchange: "sandbox-exchange", apiKey: "safe-key", apiSecret: "safe-secret", permissions
});

test("credentials are fingerprinted and never exposed", () => {
  const a = account({ read: true, trade: true });
  const state = a.publicState();
  assert.equal(state.state, ACCOUNT_STATES.PENDING);
  assert.equal(state.realEnabled, false);
  assert.notEqual(state.credentialFingerprint, "safe-key");
  assert.equal("apiSecret" in state, false);
  assert.equal(state.permissions.withdraw, false);
});

test("demo can be enabled before real trading", () => {
  const a = account();
  assert.equal(a.enableDemo(), true);
  assert.equal(a.state, ACCOUNT_STATES.DEMO_ONLY);
  assert.equal(a.demoEnabled, true);
  assert.equal(a.canTradeReal(), false);
});

test("real trading cannot unlock before verified connection and safe permissions", () => {
  const a = account({ read: true, trade: true });
  assert.throws(() => a.enableReal(), /not unlocked/);
  assert.throws(() => a.validateForReal({ connectionOk: false }), /not verified/);
});

test("read-only accounts cannot trade", () => {
  const a = account({ read: true, trade: false, withdraw: false });
  assert.throws(() => a.validateForReal({ connectionOk: true }), /trading permission required/);
});

test("withdrawal permission is always rejected", () => {
  const a = account({ read: true, trade: true, withdraw: true });
  assert.throws(() => a.validateForReal({ connectionOk: true }), /withdrawal permission is forbidden/);
  assert.equal(a.realEnabled, false);
  assert.equal(a.canTradeReal(), false);
});

test("verified safe account can unlock real trading", () => {
  const a = account({ read: true, trade: true, withdraw: false });
  assert.equal(a.validateForReal({ connectionOk: true }), true);
  assert.equal(a.state, ACCOUNT_STATES.READY_FOR_REAL);
  assert.equal(a.enableReal(), true);
  assert.equal(a.canTradeReal(), true);
});

test("disabling real trading immediately closes the real path", () => {
  const a = account({ read: true, trade: true });
  a.validateForReal({ connectionOk: true });
  a.enableReal();
  a.disableReal();
  assert.equal(a.realEnabled, false);
  assert.equal(a.state, ACCOUNT_STATES.DEMO_ONLY);
  assert.equal(a.canTradeReal(), false);
});

test("disabled account cannot re-enter real trading", () => {
  const a = account({ read: true, trade: true });
  a.state = ACCOUNT_STATES.DISABLED;
  assert.throws(() => a.enableDemo(), /disabled/);
  assert.throws(() => a.validateForReal({ connectionOk: true }), /disabled/);
});

console.log("Real User Gate: ALL TESTS PASSED");
