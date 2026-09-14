// SMART TRADING BACKTESTER v1
// Research-only: replays closed candles through the isolated smart engine.
// No exchange/API calls. Includes fees, slippage, max drawdown and walk-forward split.
import { DEFAULT_SMART_CONFIG, analyzeMarket, positionSize } from './smart-trading-engine.js';

function finite(v) { return Number.isFinite(v); }

export function backtest(candles, options = {}) {
  const cfg = { ...DEFAULT_SMART_CONFIG, ...options };
  const initialCapital = Math.max(1, Number(options.initialCapital) || 1000);
  let cash = initialCapital;
  let position = null;
  let realized = 0;
  let fees = 0;
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  let cooldown = 0;
  let wins = 0;
  let losses = 0;
  const trades = [];

  const equityAt = (price) => {
    if (!position) return cash;
    const unrealized = position.side === 'LONG'
      ? position.qty * (price - position.entry)
      : position.qty * (position.entry - price);
    return cash + (position.side === 'SHORT' ? position.margin : 0) + unrealized;
  };
  const exitPrice = (side, price) => side === 'LONG'
    ? price * (1 - cfg.slippageBps / 10000)
    : price * (1 + cfg.slippageBps / 10000);
  const entryPrice = (side, price) => side === 'LONG'
    ? price * (1 + cfg.slippageBps / 10000)
    : price * (1 - cfg.slippageBps / 10000);

  const close = (price, reason, bar) => {
    if (!position || !finite(price)) return;
    const p = position;
    const exit = exitPrice(p.side, price);
    const gross = p.side === 'LONG' ? p.qty * (exit - p.entry) : p.qty * (p.entry - exit);
    const fee = p.qty * exit * cfg.feeRate;
    const pnl = gross - fee - p.entryFee;

    if (p.side === 'LONG') cash += p.qty * exit - fee;
    else cash += p.margin + gross - fee;

    realized += pnl;
    fees += fee + p.entryFee;
    trades.push({ side: p.side, entry: p.entry, exit, qty: p.qty, pnl, reason, entryBar: p.entryBar, exitBar: bar });
    if (pnl >= 0) wins += 1; else losses += 1;
    position = null;
    cooldown = cfg.cooldownBars;
  };

  for (let i = cfg.minCandles; i < candles.length; i += 1) {
    const window = candles.slice(0, i + 1);
    const signal = analyzeMarket(window, cfg);
    const price = signal.price;
    if (!finite(price) || price <= 0) continue;

    if (position) {
      position.holdBars += 1;
      position.bestPrice = position.side === 'LONG' ? Math.max(position.bestPrice, price) : Math.min(position.bestPrice, price);
      if (finite(signal.atr)) {
        const trailing = position.side === 'LONG'
          ? position.bestPrice - signal.atr * cfg.trailingAtrMultiplier
          : position.bestPrice + signal.atr * cfg.trailingAtrMultiplier;
        position.stop = position.side === 'LONG' ? Math.max(position.stop, trailing) : Math.min(position.stop, trailing);
      }
      const stop = position.side === 'LONG' ? price <= position.stop : price >= position.stop;
      const target = position.side === 'LONG' ? price >= position.target : price <= position.target;
      const reverse = (position.side === 'LONG' && signal.action === 'SHORT') || (position.side === 'SHORT' && signal.action === 'LONG');
      if (stop) close(price, 'stop-loss-or-trailing', i);
      else if (target) close(price, 'take-profit', i);
      else if (reverse) close(price, 'confirmed-reversal', i);
      else if (position.holdBars >= cfg.maxHoldBars) close(price, 'max-hold', i);
    }

    if (!position) {
      if (cooldown > 0) cooldown -= 1;
      else if (signal.action !== 'NO_TRADE') {
        const entry = entryPrice(signal.action, price);
        const qty = positionSize({ equity: equityAt(price), entry, stop: signal.stop, riskPerTradePct: cfg.riskPerTradePct });
        const notional = qty * entry;
        const entryFee = notional * cfg.feeRate;
        if (qty > 0 && notional + entryFee <= cash) {
          cash -= notional + entryFee;
          fees += entryFee;
          position = {
            side: signal.action,
            qty,
            entry,
            entryFee,
            margin: signal.action === 'SHORT' ? notional : 0,
            entryBar: i,
            stop: signal.stop,
            target: signal.target,
            bestPrice: entry,
            holdBars: 0
          };
        }
      }
    }

    const equity = equityAt(price);
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0);
  }

  if (position && candles.length) {
    const final = Number(candles.at(-1)?.close ?? candles.at(-1)?.[4]);
    close(final, 'end-of-test', candles.length - 1);
  }

  const tradeCount = trades.length;
  const finalEquity = cash;
  const returnPct = ((finalEquity / initialCapital) - 1) * 100;
  const winRate = tradeCount ? (wins / tradeCount) * 100 : 0;
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = trades.filter(t => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  // Keep `trades` as the historical numeric count for compatibility; expose
  // the detailed trade ledger separately so callers can inspect each path.
  return {
    initialCapital,
    finalEquity,
    returnPct,
    maxDrawdownPct: maxDrawdown * 100,
    trades: tradeCount,
    tradeDetails: trades,
    wins,
    losses,
    winRate,
    profitFactor,
    fees,
    realized
  };
}

export function walkForward(candles, { trainRatio = 0.7, ...options } = {}) {
  if (!Array.isArray(candles) || candles.length < 100) return { ok: false, reason: 'insufficient-data' };
  const split = Math.floor(candles.length * trainRatio);
  if (split < 60 || candles.length - split < 40) return { ok: false, reason: 'invalid-split' };
  const train = backtest(candles.slice(0, split), options);
  const warmup = options.minCandles ?? DEFAULT_SMART_CONFIG.minCandles;
  const test = backtest(candles.slice(Math.max(0, split - warmup)), options);
  return { ok: true, split, train, test };
}
