const assert = require('assert');
const { ExchangeOrderStateMachine, STATES } = require('../src/exchange-order-state-machine');

function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (err) { console.error(`FAIL: ${name}`); throw err; }
}

test('happy path: NEW -> SUBMITTING -> OPEN -> PARTIALLY_FILLED -> FILLED', () => {
  const sm = new ExchangeOrderStateMachine();
  sm.transition(STATES.SUBMITTING);
  sm.transition(STATES.OPEN, { exchangeOrderId: 'ex-1' });
  sm.transition(STATES.PARTIALLY_FILLED, { filledQty: 2 });
  sm.transition(STATES.FILLED, { filledQty: 5 });
  assert.strictEqual(sm.state, STATES.FILLED);
  assert.strictEqual(sm.isTerminal(), true);
});

test('rejects illegal lifecycle transitions', () => {
  const sm = new ExchangeOrderStateMachine();
  assert.throws(() => sm.transition(STATES.FILLED), /invalid transition/);
  sm.transition(STATES.SUBMITTING);
  sm.transition(STATES.REJECTED);
  assert.throws(() => sm.transition(STATES.OPEN), /terminal order/);
});

test('unknown state is fail-closed and can only reconcile to a known state', () => {
  const sm = new ExchangeOrderStateMachine(STATES.SUBMITTING);
  sm.transition(STATES.UNKNOWN);
  assert.strictEqual(sm.state, STATES.UNKNOWN);
  sm.transition(STATES.OPEN);
  assert.strictEqual(sm.state, STATES.OPEN);
});

test('terminal states are immutable', () => {
  for (const terminal of [STATES.FILLED, STATES.CANCELED, STATES.REJECTED, STATES.EXPIRED]) {
    const sm = new ExchangeOrderStateMachine(STATES.SUBMITTING);
    sm.transition(terminal);
    assert.strictEqual(sm.isTerminal(), true);
    assert.throws(() => sm.transition(STATES.OPEN), /terminal order/);
  }
});

test('duplicate FILLED transition is rejected, preventing double lifecycle application', () => {
  const sm = new ExchangeOrderStateMachine(STATES.SUBMITTING);
  sm.transition(STATES.FILLED, { fillId: 'fill-1' });
  assert.throws(() => sm.transition(STATES.FILLED, { fillId: 'fill-1' }), /terminal order/);
});

test('snapshot survives restart and preserves transition history', () => {
  const first = new ExchangeOrderStateMachine();
  first.transition(STATES.SUBMITTING);
  first.transition(STATES.OPEN);
  first.transition(STATES.PARTIALLY_FILLED, { filledQty: 3 });
  const snapshot = first.snapshot();
  const restored = new ExchangeOrderStateMachine();
  restored.restore(snapshot);
  assert.deepStrictEqual(restored.snapshot(), snapshot);
  restored.transition(STATES.FILLED, { filledQty: 5 });
  assert.strictEqual(restored.state, STATES.FILLED);
});

test('corrupt restart state/history is rejected', () => {
  const sm = new ExchangeOrderStateMachine();
  assert.throws(() => sm.restore({ state: STATES.FILLED, history: [{ state: STATES.NEW }] }), /mismatch|history/);
  assert.throws(() => sm.restore({ state: STATES.OPEN, history: [{ state: STATES.NEW }, { state: STATES.FILLED }] }), /history/);
});

test('partial fill can repeat without changing semantic state', () => {
  const sm = new ExchangeOrderStateMachine(STATES.SUBMITTING);
  sm.transition(STATES.PARTIALLY_FILLED, { fillId: 'a', filledQty: 1 });
  sm.transition(STATES.PARTIALLY_FILLED, { fillId: 'b', filledQty: 2 });
  assert.strictEqual(sm.state, STATES.PARTIALLY_FILLED);
  assert.strictEqual(sm.history.length, 3);
});

console.log('Gate 7: ALL TESTS PASSED');
