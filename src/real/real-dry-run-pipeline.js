import { ExecutionEngine } from "../execution-engine.js";
import { RiskEngine } from "../risk-engine.js";
import { RiskControlledExecution } from "../risk-controlled-execution.js";
import { fetchMarketCandles } from "./market-feed.js";

const DEFAULT_MASTERS = Object.freeze({
  1: Object.freeze({ name: "Atlas Demo", fast: 9, slow: 21 }),
  2: Object.freeze({ name: "Momentum Demo", fast: 12, slow: 26 }),
  3: Object.freeze({ name: "Steady Demo", fast: 5, slow: 20 })
});

export function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  for (let i = period; i < values.length; i += 1) value = values[i] * k + value * (1 - k);
  return value;
}

export function scoreMarket({ symbol, closes, volumes, fast = 9, slow = 21 }) {
  if (!Array.isArray(closes) || !Array.isArray(volumes) || closes.length < slow + 1 || volumes.length < 2) {
    throw new Error("insufficient market data");
  }
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const previousClose = closes.at(-2);
  const currentClose = closes.at(-1);
  const change = Math.abs((currentClose - previousClose) / previousClose) * 100;
  const recentVolume = volumes.at(-1);
  const baseVolume = volumes.slice(-10).reduce((sum, value) => sum + value, 0) / Math.min(10, volumes.length);
  const volumeRatio = baseVolume > 0 ? recentVolume / baseVolume : 0;
  const trend = Math.min(100, Math.abs((fastEma - slowEma) / slowEma) * 10000);
  const liquidity = Math.min(100, 50 + Math.max(-50, Math.min(50, (volumeRatio - 1) * 50)));
  const volatility = Math.min(100, change * 8);
  const score = Math.round(trend * 0.4 + liquidity * 0.3 + volatility * 0.3);
  const sig = fastEma > slowEma ? "BUY" : "SELL";
  return Object.freeze({ symbol, fastEma, slowEma, trend, liquidity, volatility, score, sig, price: currentClose });
}

export class RealDryRunPipeline {
  constructor({ masterId = 1, masters = DEFAULT_MASTERS, riskLimits = {}, marketFeed = fetchMarketCandles } = {}) {
    const master = masters[masterId];
    if (!master) throw new Error("unknown master");
    this.master = master;
    this.marketFeed = marketFeed;
    this.execution = new ExecutionEngine();
    this.risk = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1500, ...riskLimits });
    this.gateway = new RiskControlledExecution({ riskEngine: this.risk, executionEngine: this.execution });
    this.positions = new Map();
    this.lastCandle = new Map();
    this.events = [];
  }

  evaluateMarket(input) {
    return scoreMarket({ ...input, fast: this.master.fast, slow: this.master.slow });
  }

  async cycleFromMarketFeed({ symbol, interval = "1m", limit = 60 } = {}) {
    try {
      const feed = await this.marketFeed({ symbol, interval, limit });
      return this.cycle({ symbol, closes: feed.closes, volumes: feed.volumes, candleTime: feed.candleTime, price: feed.price });
    } catch (error) {
      return this.record({ type: "NO_TRADE", symbol, reason: "MARKET_DATA_UNAVAILABLE", detail: error?.message || "unknown market feed error" });
    }
  }

  cycle({ symbol, closes, volumes, candleTime, price = null } = {}) {
    const market = this.evaluateMarket({ symbol, closes, volumes });
    const previousCandle = this.lastCandle.get(symbol);
    if (previousCandle !== undefined && candleTime <= previousCandle) return this.record({ type: "NO_TRADE", symbol, reason: "STALE_OR_DUPLICATE_CANDLE", market });
    this.lastCandle.set(symbol, candleTime);

    if (market.score < 25) return this.record({ type: "NO_TRADE", symbol, reason: "MARKET_SCORE_BELOW_25", market });

    const quantity = this.positions.get(symbol) || 0;
    const executionPrice = Number(price ?? market.price);
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) return this.record({ type: "NO_TRADE", symbol, reason: "INVALID_PRICE", market });

    if (market.sig === "BUY" && quantity === 0) {
      const qty = Math.max(0.000001, 10 / executionPrice);
      const clientOrderId = `real-dry-run:${symbol}:${candleTime}:BUY`;
      const result = this.gateway.submit({ symbol, side: "BUY", quantity: qty, price: executionPrice, clientOrderId });
      if (!result.accepted) return this.record({ type: "NO_TRADE", symbol, reason: "RISK_CHECK_FAILED", failedChecks: result.risk.failedChecks, market });
      this.positions.set(symbol, qty);
      return this.record({ type: "BUY", symbol, quantity: qty, price: executionPrice, orderId: result.order.id, market });
    }

    if (market.sig === "SELL" && quantity > 0) {
      const clientOrderId = `real-dry-run:${symbol}:${candleTime}:SELL`;
      const result = this.gateway.submit({ symbol, side: "SELL", quantity, price: executionPrice, clientOrderId });
      if (!result.accepted) return this.record({ type: "NO_TRADE", symbol, reason: "RISK_CHECK_FAILED", failedChecks: result.risk.failedChecks, market });
      this.positions.delete(symbol);
      return this.record({ type: "SELL", symbol, quantity, price: executionPrice, orderId: result.order.id, market });
    }

    return this.record({ type: "NO_TRADE", symbol, reason: market.sig === "SELL" ? "NO_LONG_POSITION_TO_CLOSE" : "POSITION_ALREADY_OPEN", market });
  }

  record(event) {
    const result = Object.freeze({ ...event, dryRun: true, master: this.master.name });
    this.events.push(result);
    return result;
  }

  getState() {
    return Object.freeze({ dryRun: true, master: this.master, positions: Object.fromEntries(this.positions), events: [...this.events], audit: this.gateway.getAuditLog() });
  }
}

export { DEFAULT_MASTERS };
