const STATES = Object.freeze({
  NEW: 'NEW',
  SUBMITTING: 'SUBMITTING',
  OPEN: 'OPEN',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  CANCELED: 'CANCELED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  UNKNOWN: 'UNKNOWN',
});

const TERMINAL = new Set([
  STATES.FILLED,
  STATES.CANCELED,
  STATES.REJECTED,
  STATES.EXPIRED,
]);

const TRANSITIONS = {
  NEW: new Set([STATES.SUBMITTING, STATES.REJECTED]),
  SUBMITTING: new Set([STATES.OPEN, STATES.PARTIALLY_FILLED, STATES.FILLED, STATES.CANCELED, STATES.REJECTED, STATES.EXPIRED, STATES.UNKNOWN]),
  OPEN: new Set([STATES.PARTIALLY_FILLED, STATES.FILLED, STATES.CANCELED, STATES.EXPIRED, STATES.UNKNOWN]),
  PARTIALLY_FILLED: new Set([STATES.PARTIALLY_FILLED, STATES.FILLED, STATES.CANCELED, STATES.EXPIRED, STATES.UNKNOWN]),
  UNKNOWN: new Set([STATES.OPEN, STATES.PARTIALLY_FILLED, STATES.FILLED, STATES.CANCELED, STATES.REJECTED, STATES.EXPIRED, STATES.UNKNOWN]),
  FILLED: new Set(),
  CANCELED: new Set(),
  REJECTED: new Set(),
  EXPIRED: new Set(),
};

class ExchangeOrderStateMachine {
  constructor(initialState = STATES.NEW) {
    if (!Object.values(STATES).includes(initialState)) throw new Error(`invalid state: ${initialState}`);
    this.state = initialState;
    this.history = [{ state: initialState, at: Date.now() }];
  }

  transition(nextState, meta = {}) {
    if (!Object.values(STATES).includes(nextState)) throw new Error(`invalid state: ${nextState}`);
    if (TERMINAL.has(this.state)) throw new Error(`terminal order cannot transition: ${this.state}`);
    const allowed = TRANSITIONS[this.state] || new Set();
    if (!allowed.has(nextState)) throw new Error(`invalid transition: ${this.state} -> ${nextState}`);
    this.state = nextState;
    this.history.push({ state: nextState, at: Date.now(), ...meta });
    return this.state;
  }

  isTerminal() { return TERMINAL.has(this.state); }

  snapshot() {
    return { state: this.state, history: this.history.map((x) => ({ ...x })) };
  }

  restore(snapshot) {
    if (!snapshot || !Object.values(STATES).includes(snapshot.state) || !Array.isArray(snapshot.history)) {
      throw new Error('invalid state machine snapshot');
    }
    let previous = snapshot.history[0]?.state;
    if (previous !== snapshot.history[0]?.state) throw new Error('invalid state history');
    for (const item of snapshot.history.slice(1)) {
      if (!Object.values(STATES).includes(item.state)) throw new Error('invalid state history');
      const allowed = TRANSITIONS[previous] || new Set();
      if (TERMINAL.has(previous) || !allowed.has(item.state)) throw new Error('invalid state history transition');
      previous = item.state;
    }
    if (previous !== snapshot.state) throw new Error('snapshot state/history mismatch');
    this.state = snapshot.state;
    this.history = snapshot.history.map((x) => ({ ...x }));
    return this.state;
  }
}

module.exports = { ExchangeOrderStateMachine, STATES, TERMINAL };