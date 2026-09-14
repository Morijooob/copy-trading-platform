// SMART TRADING ENGINE v1
// Isolated from the copy-trading execution engine until all validation gates pass.
// No real-order API is called from this module.

export const DEFAULT_SMART_CONFIG = Object.freeze({
  minCandles: 60,
  fastEma: 20,
  slowEma: 50,
  rsiPeriod: 14,
  atrPeriod: 14,
  volumePeriod: 20,
  minScore: 72,
  minTrendStrength: 0.0015,
  minVolumeRatio: 0.85,
  maxAtrPct: 0.08,
  riskPerTradePct: 0.01,
  rewardRisk: 2,
  atrStopMultiplier: 1.5,
  trailingAtrMultiplier: 1.25,
  feeRate: 0.001,
  slippageBps: 5,
  maxHoldBars: 80,
  cooldownBars: 3
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finitePositive = (value) => Number.isFinite(value) && value > 0;

function closesOf(candles) {
  return candles.map((c) => Number(c?.close ?? c?.[4]));
}

function volumesOf(candles) {
  return candles.map((c) => Number(c?.volume ?? c?.[5]));
}

function highsOf(candles) {
  return candles.map((c) => Number(c?.high ?? c?.[2]));
}

function lowsOf(candles) {
  return candles.map((c) => Number(c?.low ?? c?.[3]));
}

function validClosedCandle(candle) {
  const close = Number(candle?.close ?? candle?.[4]);
  const high = Number(candle?.high ?? candle?.[2]);
  const low = Number(candle?.low ?? candle?.[3]);
  const volume = Number(candle?.volume ?? candle?.[5]);
  return finitePositive(close) && finitePositive(high) && finitePositive(low) && finitePositive(volume) && high >= low;
}

export function ema(values, period) {
  if (!Array.isArray(values) || values.length < period || period < 1) return null;
  const alpha = 2 / (period + 1);
  let result = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i += 1) result = alpha * values[i] + (1 - alpha) * result;
  return result;
}

export function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period || period < 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    avgGain = ((avgGain * (period - 1)) + Math.max(change, 0)) / period;
    avgLoss = ((avgLoss * (period - 1)) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

export function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i += 1) {
    const high = Number(candles[i]?.high ?? candles[i]?.[2]);
    const low = Number(candles[i]?.low ?? candles[i]?.[3]);
    const prevClose = Number(candles[i - 1]?.close ?? candles[i - 1]?.[4]);
    if (![high, low, prevClose].every(Number.isFinite)) continue;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trs.length < period) return null;
  let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i += 1) value = ((value * (period - 1)) + trs[i]) / period;
  return value;
}

export function analyzeMarket(candles, config = {}) {
  const cfg = { ...DEFAULT_SMART_CONFIG, ...config };
  if (!Array.isArray(candles) || candles.length < cfg.minCandles) return { action: 'NO_TRADE', reason: 'insufficient-data', score: 0 };

  // Use only closed candles. The last candle may still be forming.
  const closed = candles.slice(0, -1);
  if (closed.length < cfg.minCandles) return { action: 'NO_TRADE', reason: 'insufficient-closed-data', score: 0 };

  // Validate the complete candle set before extracting indicators. Filtering invalid
  // values would silently misalign OHLCV series and could turn corrupt data into a trade.
  if (!closed.every(validClosedCandle)) return { action: 'NO_TRADE', reason: 'invalid-candle-data', score: 0 };

  const closes = closesOf(closed);
  const highs = highsOf(closed);
  const lows = lowsOf(closed);
  const volumes = volumesOf(closed);
  const price = closes.at(-1);
  if (!finitePositive(price)) return { action: 'NO_TRADE', reason: 'invalid-price', score: 0 };

  const fast = ema(closes, cfg.fastEma);
  const slow = ema(closes, cfg.slowEma);
  const rsiValue = rsi(closes, cfg.rsiPeriod);
  const atrValue = atr(closed, cfg.atrPeriod);
  if (![fast, slow, rsiValue, atrValue].every(Number.isFinite) || atrValue <= 0) {
    return { action: 'NO_TRADE', reason: 'indicator-failure', score: 0 };
  }

  const recentVolume = volumes.slice(-cfg.volumePeriod).reduce((a, b) => a + b, 0) / Math.max(1, volumes.slice(-cfg.volumePeriod).length);
  const priorVolume = volumes.slice(-cfg.volumePeriod * 2, -cfg.volumePeriod).reduce((a, b) => a + b, 0) / Math.max(1, volumes.slice(-cfg.volumePeriod * 2, -cfg.volumePeriod).length);
  const volumeRatio = priorVolume > 0 ? recentVolume / priorVolume : 1;
  const trendStrength = Math.abs(fast - slow) / price;
  const atrPct = atrValue / price;

  // Independent evidence buckets. This avoids a single indicator forcing a trade.
  const bullish = [
    fast > slow,
    price > fast,
    rsiValue >= 52 && rsiValue <= 72,
    volumeRatio >= cfg.minVolumeRatio,
    trendStrength >= cfg.minTrendStrength
  ];
  const bearish = [
    fast < slow,
    price < fast,
    rsiValue <= 48 && rsiValue >= 28,
    volumeRatio >= cfg.minVolumeRatio,
    trendStrength >= cfg.minTrendStrength
  ];

  const longPoints = bullish.filter(Boolean).length;
  const shortPoints = bearish.filter(Boolean).length;
  const direction = longPoints > shortPoints ? 'LONG' : shortPoints > longPoints ? 'SHORT' : 'NONE';
  const agreement = Math.max(longPoints, shortPoints);
  let score = agreement * 16;
  if (volumeRatio >= 1.1) score += 8;
  if (trendStrength >= cfg.minTrendStrength * 2) score += 8;
  if (atrPct <= cfg.maxAtrPct) score += 8;
  score = Math.round(clamp(score, 0, 100));

  if (atrPct > cfg.maxAtrPct) return { action: 'NO_TRADE', reason: 'excessive-volatility', score, price, atr: atrValue, atrPct, rsi: rsiValue, volumeRatio, trendStrength };
  if (agreement < 4 || score < cfg.minScore || direction === 'NONE') {
    return { action: 'NO_TRADE', reason: 'insufficient-confirmation', score, price, atr: atrValue, atrPct, rsi: rsiValue, volumeRatio, trendStrength };
  }

  const stopDistance = atrValue * cfg.atrStopMultiplier;
  const stop = direction === 'LONG' ? price - stopDistance : price + stopDistance;
  const target = direction === 'LONG' ? price + stopDistance * cfg.rewardRisk : price - stopDistance * cfg.rewardRisk;
  return {
    action: direction,
    reason: 'confirmed-trend',
    score,
    price,
    fastEma: fast,
    slowEma: slow,
    rsi: rsiValue,
    atr: atrValue,
    atrPct,
    volumeRatio,
    trendStrength,
    stop,
    target,
    riskDistance: stopDistance
  };
}

export function positionSize({ equity, entry, stop, riskPerTradePct = DEFAULT_SMART_CONFIG.riskPerTradePct }) {
  if (![equity, entry, stop].every(Number.isFinite) || equity <= 0 || entry <= 0 || stop <= 0) return 0;
  const riskCash = equity * clamp(riskPerTradePct, 0.0001, 0.05);
  const distance = Math.abs(entry - stop);
  return distance > 0 ? riskCash / distance : 0;
}

export class SmartTradingEngine {
  constructor({ capital = 1000, config = {} } = {}) {
    this.config = { ...DEFAULT_SMART_CONFIG, ...config };
    this.reset(capital);
  }

  reset(capital = this.capital) {
    this.capital = Math.max(1, Number(capital) || 1000);
    this.cash = this.capital;
    this.position = null;
    this.realized = 0;
    this.fees = 0;
    this.bars = 0;
    this.cooldown = 0;
    this.events = [];
  }

  emit(type, payload = {}) {
    const event = { type, bar: this.bars, ...payload };
    this.events.push(event);
    return event;
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  open(signal) {
    if (this.position || signal.action === 'NO_TRADE') return null;
    const entry = signal.action === 'LONG'
      ? signal.price * (1 + this.config.slippageBps / 10000)
      : signal.price * (1 - this.config.slippageBps / 10000);
    const qty = positionSize({ equity: this.equity(), entry, stop: signal.stop, riskPerTradePct: this.config.riskPerTradePct });
    if (!(qty > 0)) return null;
    const notional = qty * entry;
    const fee = notional * this.config.feeRate;
    if (notional + fee > this.cash) return this.emit('BLOCKED', { reason: 'insufficient-cash', action: signal.action });
    this.cash -= notional + fee;
    this.fees += fee;
    this.position = {
      side: signal.action,
      qty,
      entry,
      stop: signal.stop,
      target: signal.target,
      bestPrice: entry,
      holdBars: 0
    };
    return this.emit('OPEN', { side: signal.action, price: entry, qty, fee, score: signal.score, stop: signal.stop, target: signal.target });
  }

  markPrice(price) {
    if (!this.position || !finitePositive(price)) return 0;
    return this.position.side === 'LONG'
      ? this.position.qty * (price - this.position.entry)
      : this.position.qty * (this.position.entry - price);
  }

  equity(price = null) {
    return this.cash + (this.position ? this.position.qty * (price ?? this.position.entry) : 0);
  }

  close(price, reason) {
    if (!this.position || !finitePositive(price)) return null;
    const p = this.position;
    const exit = p.side === 'LONG'
      ? price * (1 - this.config.slippageBps / 10000)
      : price * (1 + this.config.slippageBps / 10000);
    const gross = this.markPrice(exit);
    const fee = p.qty * exit * this.config.feeRate;
    const pnl = gross - fee;
    this.cash += p.qty * exit - fee;
    this.realized += pnl;
    this.fees += fee;
    this.position = null;
    this.cooldown = this.config.cooldownBars;
    return this.emit('CLOSE', { side: p.side, price: exit, reason, pnl, fee });
  }

  process(candles) {
    this.bars += 1;
    const signal = analyzeMarket(candles, this.config);
    const current = signal.price;
    if (!finitePositive(current)) return this.snapshot(signal);

    if (this.position) {
      this.position.holdBars += 1;
      if (this.position.side === 'LONG') this.position.bestPrice = Math.max(this.position.bestPrice, current);
      else this.position.bestPrice = Math.min(this.position.bestPrice, current);

      const trailing = this.position.side === 'LONG'
        ? this.position.bestPrice - (signal.atr ?? 0) * this.config.trailingAtrMultiplier
        : this.position.bestPrice + (signal.atr ?? 0) * this.config.trailingAtrMultiplier;
      if (this.position.side === 'LONG') this.position.stop = Math.max(this.position.stop, trailing);
      else this.position.stop = Math.min(this.position.stop, trailing);

      const stopHit = this.position.side === 'LONG' ? current <= this.position.stop : current >= this.position.stop;
      const targetHit = this.position.side === 'LONG' ? current >= this.position.target : current <= this.position.target;
      const reverse = (this.position.side === 'LONG' && signal.action === 'SHORT') || (this.position.side === 'SHORT' && signal.action === 'LONG');
      const timedOut = this.position.holdBars >= this.config.maxHoldBars;
      if (stopHit) this.close(current, 'stop-loss-or-trailing');
      else if (targetHit) this.close(current, 'take-profit');
      else if (reverse) this.close(current, 'confirmed-reversal');
      else if (timedOut) this.close(current, 'max-hold');
    }

    if (!this.position) {
      if (this.cooldown > 0) this.cooldown -= 1;
      else if (signal.action !== 'NO_TRADE') this.open(signal);
    }
    return this.snapshot(signal);
  }

  snapshot(signal) {
    const unrealized = this.position ? this.markPrice(signal?.price) : 0;
    return {
      capital: this.capital,
      cash: this.cash,
      equity: this.cash + (this.position ? this.position.qty * (signal?.price ?? this.position.entry) : 0),
      realized: this.realized,
      unrealized,
      totalPnl: this.realized + unrealized,
      fees: this.fees,
      cooldown: this.cooldown,
      position: this.position ? { ...this.position } : null,
      signal
    };
  }
}
