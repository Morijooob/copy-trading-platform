const DEFAULT_BASE_URL = "https://api.binance.com/api/v3/klines";

const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

export async function fetchMarketCandles({
  symbol,
  interval = "1m",
  limit = 60,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 8000
} = {}) {
  if (!SYMBOL_RE.test(String(symbol || ""))) throw new Error("invalid symbol");
  if (!Number.isInteger(limit) || limit < 21 || limit > 1000) throw new Error("invalid limit");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation unavailable");

  const url = new URL(baseUrl);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
    if (!response || !response.ok) throw new Error(`market feed http ${response?.status ?? "unknown"}`);
    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length < 21) throw new Error("malformed market response");

    const candles = payload.map((row, index) => {
      if (!Array.isArray(row) || row.length < 7) throw new Error(`malformed candle ${index}`);
      const openTime = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[5]);
      const closeTime = Number(row[6]);
      if (!Number.isInteger(openTime) || !Number.isInteger(closeTime) || closeTime <= openTime) throw new Error(`invalid candle time ${index}`);
      if (![open, high, low, close, volume].every(finitePositive)) throw new Error(`invalid candle value ${index}`);
      if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) throw new Error(`invalid candle range ${index}`);
      return Object.freeze({ openTime, closeTime, open, high, low, close, volume });
    });

    for (let i = 1; i < candles.length; i += 1) {
      if (candles[i].openTime <= candles[i - 1].openTime) throw new Error("non-monotonic candles");
    }

    return Object.freeze({
      symbol,
      interval,
      candles: Object.freeze(candles),
      closes: Object.freeze(candles.map((c) => c.close)),
      volumes: Object.freeze(candles.map((c) => c.volume)),
      candleTime: candles.at(-1).openTime,
      price: candles.at(-1).close,
      source: "binance-public"
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("market feed timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export { DEFAULT_BASE_URL };
