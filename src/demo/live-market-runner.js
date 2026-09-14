// LIVE_MARKET_DRY_RUN: public market data only. Never places exchange orders.
import { DemoTradingEngine } from './demo-trading-engine.js';

export const LIVE_SYMBOLS = Object.freeze({ BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD' });
const API = 'https://api.exchange.coinbase.com/products';
const INTERVAL_SECONDS = 60;

function toRows(candles) {
  if (!Array.isArray(candles)) return [];
  return candles.map((c) => [Number(c[0]) * 1000, Number(c[3]), Number(c[2]), Number(c[1]), Number(c[4]), Number(c[5])])
    .filter((r) => r.every(Number.isFinite)).sort((a, b) => a[0] - b[0]);
}

export async function fetchLiveCandles(productId, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('LIVE_FEED_UNAVAILABLE');
  const url = `${API}/${encodeURIComponent(productId)}/candles?granularity=${INTERVAL_SECONDS}`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response?.ok) throw new Error(`LIVE_FEED_HTTP_${response?.status ?? 'UNKNOWN'}`);
  const rows = toRows(await response.json());
  if (rows.length < 21) throw new Error('LIVE_FEED_INSUFFICIENT_CANDLES');
  return rows;
}

export class LiveMarketDryRun {
  constructor({ capital = 100, fetchImpl = globalThis.fetch, engineConfig = {} } = {}) {
    this.fetchImpl = fetchImpl;
    this.engine = new DemoTradingEngine({ capital, config: engineConfig });
    this.running = false;
    this.lastUpdate = null;
    this.lastError = null;
    this.lastMarkets = {};
    this.timer = null;
  }

  async tick() {
    const markets = {};
    for (const [symbol, productId] of Object.entries(LIVE_SYMBOLS)) markets[symbol] = await fetchLiveCandles(productId, this.fetchImpl);
    const snapshot = this.engine.process(markets);
    this.lastMarkets = markets;
    this.lastUpdate = new Date().toISOString();
    this.lastError = null;
    return snapshot;
  }

  async safeTick() {
    try { return await this.tick(); }
    catch (error) { this.lastError = error instanceof Error ? error.message : String(error); return this.engine.snapshot(); }
  }

  start(onUpdate, intervalMs = 20000) {
    this.stop(); this.running = true;
    const run = async () => { if (!this.running) return; const snapshot = await this.safeTick(); if (typeof onUpdate === 'function') onUpdate(snapshot, this); };
    run(); this.timer = setInterval(run, intervalMs);
  }

  stop() { this.running = false; if (this.timer) clearInterval(this.timer); this.timer = null; }

  reset(capital = this.engine.capital) { this.stop(); this.engine.reset(capital); this.lastUpdate = null; this.lastError = null; this.lastMarkets = {}; }
}

export function createLiveMarketDryRun(options = {}) { return new LiveMarketDryRun(options); }
