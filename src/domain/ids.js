let sequence = 0;

export function createClientOrderId(prefix = 'COPY') {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(6, '0')}`;
}

export function resetIdSequence() {
  sequence = 0;
}
