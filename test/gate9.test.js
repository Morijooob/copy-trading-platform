import assert from 'node:assert/strict';
import { SecurityControl } from '../src/security-control.js';
import { SecurityControlledExecution } from '../src/security-controlled-execution.js';
import { RiskEngine } from '../src/risk-engine.js';
import { ExecutionEngine } from '../src/execution-engine.js';
import { RiskControlledExecution } from '../src/risk-controlled-execution.js';

const test = (name, fn) => { try { fn(); console.log(`PASS: ${name}`); } catch (err) { console.error(`FAIL: ${name}`); throw err; } };
const makeExecution = () => new RiskControlledExecution({
  riskEngine: new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 100, maxExposure: 1000 }),
  executionEngine: new ExecutionEngine()
});
const order = { symbol: 'BTCUSDT', side: 'BUY', quantity: 1, price: 100, clientOrderId: 'gate9-1' };

test('kill switch blocks new orders at the execution boundary', () => {
  const security = new SecurityControl({ actorId: 'ops', role: 'admin' });
  const guarded = new SecurityControlledExecution({ securityControl: security, execution: makeExecution() });
  guarded.setKillSwitch(true, 'incident-1', { actorId: 'ops', role: 'admin' });
  assert.throws(() => guarded.submit(order), /kill switch/);
  guarded.setKillSwitch(false, 'incident-resolved', { actorId: 'ops', role: 'admin' });
  assert.equal(guarded.submit(order).accepted, true);
});

test('kill switch survives restart state restore', () => {
  const a = new SecurityControl({ actorId: 'ops', role: 'admin' });
  a.setKillSwitch(true, 'exchange anomaly');
  const b = new SecurityControl({ state: a.exportState() });
  assert.equal(b.killSwitch, true);
  assert.throws(() => b.assertTradingAllowed(), /kill switch/);
});

test('unauthorized kill switch changes fail closed', () => {
  const security = new SecurityControl({ actorId: 'ops', role: 'viewer' });
  assert.throws(() => security.setKillSwitch(true, 'attack', { actorId: 'attacker', role: 'viewer' }), /unauthorized/);
  assert.equal(security.killSwitch, false);
});

test('audit log is append-only and hash-chain integrity detects tampering', () => {
  const security = new SecurityControl({ actorId: 'ops', role: 'admin' });
  security.auditEvent('ORDER_SUBMITTED', { orderId: '1', amount: 100 });
  security.auditEvent('ORDER_FILLED', { orderId: '1', amount: 100 });
  assert.equal(security.verifyAuditIntegrity(), true);
  const state = security.exportState();
  state.audit[1].payload.amount = 999999;
  assert.throws(() => new SecurityControl({ state }), /integrity failure/);
});

test('audit detects deletion, reordering, and injection', () => {
  const security = new SecurityControl({ actorId: 'ops', role: 'admin' });
  security.auditEvent('A', { n: 1 });
  security.auditEvent('B', { n: 2 });
  const deleted = security.exportState(); deleted.audit.pop();
  const reordered = security.exportState(); [reordered.audit[0], reordered.audit[1]] = [reordered.audit[1], reordered.audit[0]];
  const injected = security.exportState(); injected.audit.push({ eventId: '3', type: 'FORGED', actorId: 'attacker', payload: {}, previousHash: injected.lastHash, hash: 'bad' }); injected.sequence = 3;
  assert.throws(() => new SecurityControl({ state: deleted }), /sequence mismatch/);
  assert.throws(() => new SecurityControl({ state: reordered }), /integrity failure/);
  assert.throws(() => new SecurityControl({ state: injected }), /integrity failure/);
});

test('sensitive audit fields are redacted recursively', () => {
  const security = new SecurityControl({ actorId: 'ops', role: 'admin' });
  security.auditEvent('CREDENTIAL_TEST', { apiKey: 'SECRET', nested: { password: 'PW', token: 'TOK', safe: 'ok' }, authorization: 'Bearer abc' });
  const payload = security.getAuditLog().at(-1).payload;
  assert.equal(payload.apiKey, '[REDACTED]');
  assert.equal(payload.nested.password, '[REDACTED]');
  assert.equal(payload.nested.token, '[REDACTED]');
  assert.equal(payload.authorization, '[REDACTED]');
  assert.equal(payload.nested.safe, 'ok');
  assert.equal(JSON.stringify(payload).includes('SECRET'), false);
});

test('repeated kill switch activation remains safe and auditable', () => {
  const security = new SecurityControl({ actorId: 'ops', role: 'admin' });
  for (let i = 0; i < 100; i++) security.setKillSwitch(true, `incident-${i}`);
  assert.equal(security.killSwitch, true);
  assert.equal(security.verifyAuditIntegrity(), true);
  assert.equal(security.getAuditLog().length, 200);
});

test('risk engine kill switch remains fail closed at risk layer', () => {
  const risk = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 100, maxExposure: 1000 });
  risk.setKillSwitch(true, 'security incident');
  const decision = risk.approve({ side: 'BUY', quantity: 1, price: 100 });
  assert.equal(decision.approved, false);
  assert.equal(decision.failedChecks.includes('KILL_SWITCH'), true);
});

console.log('Gate 9: ALL TESTS PASSED');
