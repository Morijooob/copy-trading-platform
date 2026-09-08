export class FaultInjector {
  constructor(points = new Set()) {
    this.points = new Set(points);
  }

  shouldFail(point) {
    return this.points.has(point);
  }
}

export const FAULT_POINTS = Object.freeze({
  BEFORE_SEND: 'BEFORE_SEND',
  AFTER_ACCEPT_BEFORE_RESPONSE: 'AFTER_ACCEPT_BEFORE_RESPONSE',
  AFTER_FILL_BEFORE_LEDGER: 'AFTER_FILL_BEFORE_LEDGER',
  TIMEOUT_RESPONSE: 'TIMEOUT_RESPONSE',
  CRASH_AFTER_ACCEPT: 'CRASH_AFTER_ACCEPT',
  CRASH_AFTER_PARTIAL_FILL: 'CRASH_AFTER_PARTIAL_FILL'
});
