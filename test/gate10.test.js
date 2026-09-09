import assert from "node:assert/strict";
import { SecurityControl } from "../src/security-control.js";
import { SecurityControlledExecution } from "../src/security-controlled-execution.js";
import { RiskEngine } from "../src/risk-engine.js";
import { RiskControlledExecution } from "../src/risk-controlled-execution.js";
import { ExecutionEngine } from "../src/execution-engine.js";
import { MultiAccountCopyExecution } from "../src/multi-account-copy-execution.js";
import { PersistentNetworkResilience } from "../src/persistent-network-resilience.js";
import { NetworkPersistenceStore } from "../src/network-persistence-store.js";
import { ExchangeOrderStateMachine, STATES } from "../src/exchange-order-state-machine.js";

const test = (name, fn) => {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (error) { console.error(`FAIL: ${name}`); throw error; }
};

const makeRiskGateway = (maxExposure = 1000000) => {
  const risk = new RiskEngine({ maxOrderNotional: 10000, maxDailyLoss: 5000, maxExposure });
  const execution = new ExecutionEngine();
  const gateway = new RiskControlledExecution({ riskEngine: risk, executionEngine: execution });
  return { risk, execution, gateway };
};

test("production baseline: all critical modules instantiate", () => {
  const { risk, execution, gateway } = makeRiskGateway();
  const security = new SecurityControl({ actorId: "ops", role: "admin" });
  const guarded = new SecurityControlledExecution({ securityControl: security, execution: gateway });
  const copy = new MultiAccountCopyExecution({ accounts: [{ accountId: "prod-a", riskEngine: risk, executionEngine: execution }] });
  const stateMachine = new ExchangeOrderStateMachine();
  const network = new PersistentNetworkResilience({ submit: () => ({ accepted: true, exchangeOrderId: "ex-baseline" }), reconcile: () => ({ confirmed: false }), store: new NetworkPersistenceStore() });
  assert.ok(guarded && copy && stateMachine && network);
});

test("end-to-end guarded order preserves risk reservation and security audit", () => {
  const { risk, execution, gateway } = makeRiskGateway();
  const security = new SecurityControl({ actorId: "ops", role: "admin" });
  const guarded = new SecurityControlledExecution({ securityControl: security, execution: gateway });
  const result = guarded.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, clientOrderId: "g10-e2e" });
  assert.equal(result.accepted, true);
  assert.equal(risk.reservedExposure, 200);
  assert.equal(execution.getOrderById(result.order.id).status, "PENDING");
  assert.equal(security.verifyAuditIntegrity(), true);
  assert.equal(security.getAuditLog().at(-1).type, "ORDER_SUBMITTED");
});

test("kill switch is an immediate production stop and restart-safe", () => {
  const { gateway } = makeRiskGateway();
  const security = new SecurityControl({ actorId: "ops", role: "admin" });
  const guarded = new SecurityControlledExecution({ securityControl: security, execution: gateway });
  security.setKillSwitch(true, "production incident");
  assert.throws(() => guarded.submit({ symbol: "ETHUSDT", side: "BUY", quantity: 1, price: 100, clientOrderId: "g10-stop" }), /kill switch/);
  const restored = new SecurityControl({ state: security.exportState() });
  assert.equal(restored.killSwitch, true);
  assert.throws(() => restored.assertTradingAllowed(), /kill switch/);
});

test("partial fill, duplicate fill, and full fill never overcount exposure", () => {
  const { risk, gateway } = makeRiskGateway(1000);
  const submitted = gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 5, price: 100, clientOrderId: "g10-fill" });
  gateway.onExchangeFill(submitted.order.id, 2, "fill-a");
  assert.equal(risk.exposure, 200);
  assert.equal(risk.reservedExposure, 300);
  gateway.onExchangeFill(submitted.order.id, 2, "fill-a");
  assert.equal(risk.exposure, 200);
  assert.equal(risk.reservedExposure, 300);
  gateway.onExchangeFill(submitted.order.id, 3, "fill-b");
  assert.equal(risk.exposure, 500);
  assert.equal(risk.reservedExposure, 0);
});

test("persistent network recovery never submits twice after positive reconciliation", () => {
  const store = new NetworkPersistenceStore();
  let submits = 0;
  const first = new PersistentNetworkResilience({ store, submit: () => { submits++; throw new Error("response lost"); }, reconcile: () => ({ confirmed: false }) });
  assert.equal(first.execute({ clientRequestId: "g10-net", order: { symbol: "BTCUSDT", side: "BUY", quantity: 1 } }).status, "UNKNOWN");
  const restarted = new PersistentNetworkResilience({ store, submit: () => { submits++; return { accepted: true, exchangeOrderId: "never-submit" }; }, reconcile: () => ({ confirmed: true, exchangeOrderId: "ex-recovered", filledQty: 0 }) });
  const recovered = restarted.recoverAfterRestart();
  assert.equal(recovered[0].status, "CONFIRMED");
  assert.equal(recovered[0].exchangeOrderId, "ex-recovered");
  assert.equal(submits, 1);
});

test("positive recovery without exchange order id fails closed", () => {
  const store = new NetworkPersistenceStore();
  const engine = new PersistentNetworkResilience({ store, submit: () => { throw new Error("timeout"); }, reconcile: () => ({ confirmed: false }) });
  engine.execute({ clientRequestId: "g10-invalid-confirm", order: { symbol: "BTCUSDT", side: "BUY", quantity: 1 } });
  const restarted = new PersistentNetworkResilience({ store, submit: () => ({ accepted: true, exchangeOrderId: "bad-path" }), reconcile: () => ({ confirmed: true }) });
  assert.throws(() => restarted.recoverAfterRestart(), /exchange order id/);
});

test("state machine survives a full lifecycle and rejects terminal mutation", () => {
  const sm = new ExchangeOrderStateMachine();
  sm.transition(STATES.SUBMITTING);
  sm.transition(STATES.OPEN);
  sm.transition(STATES.PARTIALLY_FILLED, { filledQty: 3 });
  sm.transition(STATES.FILLED, { filledQty: 5 });
  const snapshot = sm.snapshot();
  const restored = new ExchangeOrderStateMachine();
  restored.restore(snapshot);
  assert.equal(restored.state, STATES.FILLED);
  assert.throws(() => restored.transition(STATES.OPEN), /terminal/);
});

test("copy execution isolates account failures and remains idempotent", () => {
  const good = { accountId: "good", riskEngine: new RiskEngine({ maxOrderNotional: 10000, maxDailyLoss: 5000, maxExposure: 10000 }), executionEngine: new ExecutionEngine() };
  const bad = { accountId: "bad", riskEngine: new RiskEngine({ maxOrderNotional: 10000, maxDailyLoss: 5000, maxExposure: 10000 }), executionEngine: new ExecutionEngine() };
  bad.executionEngine.createOrder = () => { throw new Error("exchange unavailable"); };
  const copy = new MultiAccountCopyExecution({ accounts: [good, bad] });
  const signal = { signalId: "g10-copy", symbol: "ETHUSDT", side: "BUY", quantity: 1, price: 100 };
  const first = copy.executeCopy(signal);
  assert.equal(first.submitted, 1);
  assert.equal(first.failed, 1);
  assert.equal(bad.riskEngine.reservedExposure, 0);
  const second = copy.executeCopy(signal);
  assert.equal(second.idempotent, 1);
  assert.equal(second.failed, 1);
});

test("security export contains no sensitive credential material", () => {
  const security = new SecurityControl({ actorId: "ops", role: "admin" });
  security.auditEvent("CREDENTIALS", { apiKey: "LIVE_KEY", password: "LIVE_PASSWORD", nested: { token: "LIVE_TOKEN" }, safe: "ok" });
  const serialized = JSON.stringify(security.exportState());
  assert.equal(serialized.includes("LIVE_KEY"), false);
  assert.equal(serialized.includes("LIVE_PASSWORD"), false);
  assert.equal(serialized.includes("LIVE_TOKEN"), false);
  assert.equal(security.verifyAuditIntegrity(), true);
});

test("stress: 200 isolated accounts x 20 signals, then replay every signal", () => {
  const accounts = Array.from({ length: 200 }, (_, i) => ({
    accountId: `stress-${i}`,
    riskEngine: new RiskEngine({ maxOrderNotional: 10000, maxDailyLoss: 5000, maxExposure: 1000000 }),
    executionEngine: new ExecutionEngine()
  }));
  accounts[17].executionEngine.createOrder = () => { throw new Error("isolated exchange failure"); };
  const copy = new MultiAccountCopyExecution({ accounts });
  for (let i = 0; i < 20; i++) {
    const result = copy.executeCopy({ signalId: `stress-${i}`, symbol: "BTCUSDT", side: i % 2 ? "SELL" : "BUY", quantity: 1, price: 100 });
    assert.equal(result.submitted, 199);
    assert.equal(result.failed, 1);
  }
  for (let i = 0; i < 20; i++) {
    const result = copy.executeCopy({ signalId: `stress-${i}`, symbol: "BTCUSDT", side: i % 2 ? "SELL" : "BUY", quantity: 1, price: 100 });
    assert.equal(result.idempotent, 199);
    assert.equal(result.failed, 1);
  }
  assert.equal(accounts[17].riskEngine.reservedExposure, 0);
  for (const account of accounts.filter((_, i) => i !== 17)) assert.equal(account.riskEngine.reservedExposure, 2000);
});

test("stress: 1000 security stop toggles preserve audit integrity and final stop", () => {
  const security = new SecurityControl({ actorId: "ops", role: "admin" });
  for (let i = 0; i < 1000; i++) security.setKillSwitch(i % 2 === 0, `stress-${i}`);
  assert.equal(security.killSwitch, false);
  assert.equal(security.verifyAuditIntegrity(), true);
  assert.equal(security.getAuditLog().length, 3000);
  const restored = new SecurityControl({ state: security.exportState() });
  assert.equal(restored.verifyAuditIntegrity(), true);
  assert.equal(restored.killSwitch, false);
});

console.log("Gate 10: ALL TESTS PASSED");
