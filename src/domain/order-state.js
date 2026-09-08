export const ORDER_STATES = Object.freeze({
  CREATED: 'CREATED',
  SENT: 'SENT',
  UNKNOWN: 'UNKNOWN',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED'
});

const transitions = {
  CREATED: new Set(['SENT', 'REJECTED', 'CANCELLED']),
  SENT: new Set(['UNKNOWN', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED']),
  UNKNOWN: new Set(['PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED']),
  PARTIALLY_FILLED: new Set(['PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED']),
  FILLED: new Set(),
  REJECTED: new Set(),
  CANCELLED: new Set()
};

export function canTransition(from, to) {
  return transitions[from]?.has(to) ?? false;
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid order transition: ${from} -> ${to}`);
  }
}
