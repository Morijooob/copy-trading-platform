export const DEFAULTS = Object.freeze({
  minScore: 20,
  feeRate: 0.001,
  maxCapitalFraction: 0.95
});

export function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i += 1) e = values[i] * k + e * (1 - k);
  return e;
}

export function computeMarketSignal({ closes, volumes, fast = 9, slow = 21, minScore = DEFAULTS.minScore }) {
  if (!Array.isArray(closes) || closes.length < Math.max(30, slow + 2)) throw new Error('insufficient closes');
  if (!Array.isArray(volumes) || volumes.length !== closes.length) throw new Error('invalid volumes');
  const clean = closes.map(Number);
  const vol = volumes.map(Number);
  if (!clean.every(Number.isFinite) || !vol.every(Number.isFinite) || clean.some(v => v <= 0) || vol.some(v => v < 0)) throw new Error('invalid market data');
  const fastEma = ema(clean, fast);
  const slowEma = ema(clean, slow);
  const avgVol = vol.reduce((a, b) => a + b, 0) / vol.length;
  const recentVol = vol.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const volumeRatio = avgVol > 0 ? recentVol / avgVol : 1;
  const changePct = Math.abs(((clean.at(-1) - clean[0]) / clean[0]) * 100);
  const trendRaw = Math.min(100, Math.max(0, Math.abs((fastEma - slowEma) / slowEma) * 10000));
  const liquidityRaw = Math.min(100, Math.max(0, 50 + Math.max(-50, Math.min(50, (volumeRatio - 1) * 50))));
  const volatilityRaw = Math.min(100, Math.max(0, changePct * 8));
  const trend = Math.min(40, trendRaw * 0.4);
  const liquidity = Math.min(30, liquidityRaw * 0.3);
  const volatility = Math.min(30, volatilityRaw * 0.3);
  const score = Math.round(trend + liquidity + volatility);
  const side = fastEma >= slowEma ? 'BUY' : 'SELL';
  return { score, side, fastEma, slowEma, trend, liquidity, volatility, volumeRatio, minScore, tradable: score >= minScore };
}

export function nextPositionAction({ side, position = 'FLAT', score, minScore = DEFAULTS.minScore }) {
  if (!['BUY', 'SELL'].includes(side)) throw new Error('invalid side');
  if (!['FLAT', 'LONG', 'SHORT'].includes(position)) throw new Error('invalid position');
  if (!Number.isFinite(score) || score < minScore) return { action: 'NO_TRADE', target: position, reason: 'SCORE_TOO_LOW' };
  if (side === 'BUY') {
    if (position === 'SHORT') return { action: 'CLOSE_SHORT_THEN_LONG', target: 'LONG', reason: 'SIGNAL_FLIP' };
    if (position === 'LONG') return { action: 'HOLD', target: 'LONG', reason: 'ALREADY_LONG' };
    return { action: 'OPEN_LONG', target: 'LONG', reason: 'BUY_SIGNAL' };
  }
  if (position === 'LONG') return { action: 'CLOSE_LONG_THEN_SHORT', target: 'SHORT', reason: 'SIGNAL_FLIP' };
  if (position === 'SHORT') return { action: 'HOLD', target: 'SHORT', reason: 'ALREADY_SHORT' };
  return { action: 'OPEN_SHORT', target: 'SHORT', reason: 'SELL_SIGNAL' };
}
