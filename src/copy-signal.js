const SIDES = new Set(['BUY', 'SELL']);

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
  return value.trim();
}

function requirePositive(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`);
  return value;
}

export function createCopySignal({
  signalId,
  masterId,
  symbol,
  side,
  quantity,
  price = null,
  timestamp = Date.now(),
  metadata = {}
} = {}) {
  signalId = requireString(signalId, 'signalId');
  masterId = requireString(masterId, 'masterId');
  symbol = requireString(symbol, 'symbol').toUpperCase();
  if (!SIDES.has(side)) throw new Error(`invalid signal side: ${side}`);
  quantity = requirePositive(quantity, 'quantity');
  if (price !== null) requirePositive(price, 'price');
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('timestamp must be positive');
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('metadata must be an object');

  return Object.freeze({
    signalId,
    masterId,
    symbol,
    side,
    quantity,
    price,
    timestamp,
    metadata: Object.freeze({ ...metadata })
  });
}
