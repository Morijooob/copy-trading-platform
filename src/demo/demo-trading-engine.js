export const DEFAULT_DEMO_CONFIG = Object.freeze({
  feeRate: 0.001,
  allocationPct: 0.95,
  minScore: 20,
  takeProfitPct: 0.004,
  stopLossPct: 0.006,
  maxHoldCycles: 12,
  cooldownCycles: 1
});

export function signalFromRows(rows) {
  if (!Array.isArray(rows)) return null;
  const closed = rows.slice(0, -1);
  const closes = closed.map((row) => Number(row?.[4])).filter(Number.isFinite);
  if (closes.length < 20) return null;
  const latest = closes.at(-1);
  const baseline = closes.at(-20);
  if (!(baseline > 0)) return null;
  const signal = latest >= baseline ? 'BUY' : 'SELL';
  const score = Math.round(Math.min(100, 20 + Math.min(40, Math.abs((latest - baseline) / baseline) * 8000)));
  const price = Number(rows.at(-1)?.[4]);
  if (!(price > 0)) return null;
  return { price, signal, score };
}

function clonePosition(position) {
  return position ? { ...position } : null;
}

export class DemoTradingEngine {
  constructor({ capital = 10, config = {} } = {}) {
    this.config = { ...DEFAULT_DEMO_CONFIG, ...config };
    this.reset(capital);
  }

  reset(capital = this.capital) {
    this.capital = Math.max(1, Number(capital) || 10);
    this.cash = this.capital;
    this.position = null;
    this.realized = 0;
    this.fees = 0;
    this.orders = 0;
    this.cycleCount = 0;
    this.cooldown = 0;
    this.lastPrices = {};
    this.lastSignals = {};
    this.events = [];
  }

  emit(type, payload = {}) {
    const event = { type, cycle: this.cycleCount, ...payload };
    this.events.push(event);
    return event;
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  open(symbol, side, price) {
    if (this.position || !(price > 0)) return null;
    const allocation = this.cash * this.config.allocationPct;
    if (!(allocation > 0)) return null;
    const fee = allocation * this.config.feeRate;
    const notional = allocation - fee;
    const qty = notional / price;
    if (!(qty > 0)) return null;
    this.cash -= allocation;
    this.fees += fee;
    this.orders += 1;
    this.position = { symbol, side, qty, entry: price, margin: notional, holdCycles: 0 };
    return this.emit('OPEN', { symbol, side, price, fee, qty });
  }

  unrealized() {
    if (!this.position) return 0;
    const price = this.lastPrices[this.position.symbol];
    if (!(price > 0)) return 0;
    return this.position.side === 'LONG'
      ? this.position.qty * (price - this.position.entry)
      : this.position.qty * (this.position.entry - price);
  }

  close(reason = 'manual') {
    if (!this.position) return null;
    const p = this.position;
    const price = this.lastPrices[p.symbol];
    if (!(price > 0)) return null;
    const pnlBeforeFee = this.unrealized();
    const exitNotional = p.qty * price;
    const exitFee = exitNotional * this.config.feeRate;
    const result = pnlBeforeFee - exitFee;
    this.cash += p.margin + pnlBeforeFee - exitFee;
    this.realized += result;
    this.fees += exitFee;
    this.orders += 1;
    this.position = null;
    this.cooldown = this.config.cooldownCycles;
    return this.emit('CLOSE', { symbol: p.symbol, side: p.side, price, reason, result, fee: exitFee });
  }

  process(markets) {
    this.cycleCount += 1;
    const signals = {};
    const prices = {};
    for (const [symbol, rows] of Object.entries(markets || {})) {
      const signal = signalFromRows(rows);
      if (signal) {
        signals[symbol] = signal;
        prices[symbol] = signal.price;
      }
    }
    this.lastPrices = { ...this.lastPrices, ...prices };
    this.lastSignals = signals;

    const ranked = Object.entries(signals)
      .filter(([, d]) => d.score >= this.config.minScore)
      .sort((a, b) => b[1].score - a[1].score);
    const best = ranked[0] ? { symbol: ranked[0][0], ...ranked[0][1] } : null;

    if (this.position) {
      this.position.holdCycles += 1;
      const positionSignal = signals[this.position.symbol];
      const entry = this.position.entry;
      const currentPrice = this.lastPrices[this.position.symbol];
      const movePct = this.position.side === 'LONG'
        ? (currentPrice - entry) / entry
        : (entry - currentPrice) / entry;

      // Hard risk exits always win over strategy reversal. This prevents a
      // signal flip from masking a stop-loss/take-profit event.
      let reason = null;
      if (movePct >= this.config.takeProfitPct) reason = 'take-profit';
      else if (movePct <= -this.config.stopLossPct) reason = 'stop-loss';
      else if (this.position.holdCycles >= this.config.maxHoldCycles) reason = 'max-hold';
      else if (positionSignal && ((this.position.side === 'LONG' && positionSignal.signal === 'SELL') || (this.position.side === 'SHORT' && positionSignal.signal === 'BUY'))) reason = 'reverse-signal';

      if (reason) this.close(reason);
    }

    if (!this.position && this.cooldown > 0) {
      this.cooldown -= 1;
    } else if (!this.position && best) {
      this.open(best.symbol, best.signal === 'BUY' ? 'LONG' : 'SHORT', best.price);
    } else if (this.position && best) {
      this.emit('HOLD', { symbol: this.position.symbol, side: this.position.side, price: this.lastPrices[this.position.symbol], bestSymbol: best.symbol, bestSignal: best.signal });
    }

    return this.snapshot(best);
  }

  snapshot(best = null) {
    const unrealized = this.unrealized();
    const equity = this.position
      ? this.cash + this.position.margin + unrealized
      : this.cash;
    const position = clonePosition(this.position);
    return {
      capital: this.capital,
      cash: this.cash,
      equity,
      realized: this.realized,
      unrealized,
      totalPnl: this.realized + unrealized,
      fees: this.fees,
      orders: this.orders,
      cycleCount: this.cycleCount,
      cooldown: this.cooldown,
      position,
      lastPrices: { ...this.lastPrices },
      lastSignals: { ...this.lastSignals },
      best
    };
  }
}
