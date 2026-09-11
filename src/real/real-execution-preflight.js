import { ProductionSecurityGate } from "../production-security-gate.js";
import { fetchMarketCandles } from "./market-feed.js";

export class RealExecutionPreflight {
  constructor({
    securityGate = new ProductionSecurityGate(),
    exirAdapter = null,
    marketFeed = fetchMarketCandles,
    symbol = "BTCUSDT",
    interval = "1m",
    limit = 60,
    minimumAvailableBalance = 0
  } = {}) {
    this.securityGate = securityGate;
    this.exirAdapter = exirAdapter;
    this.marketFeed = marketFeed;
    this.symbol = symbol;
    this.interval = interval;
    this.limit = limit;
    this.minimumAvailableBalance = minimumAvailableBalance;
  }

  async run() {
    const checks = [];

    const security = this.securityGate.evaluate();
    checks.push({
      name: "PRODUCTION_SECURITY_GATE",
      passed: security.readyForRealMoney,
      detail: security.readyForRealMoney ? "all required controls enabled" : security.failedControls.join(",")
    });

    let market = null;
    try {
      market = await this.marketFeed({ symbol: this.symbol, interval: this.interval, limit: this.limit });
      const valid = Number.isFinite(market?.price) && market.price > 0 && Number.isFinite(market?.candleTime);
      checks.push({ name: "MARKET_DATA", passed: valid, detail: valid ? "fresh market snapshot available" : "invalid market snapshot" });
    } catch (error) {
      checks.push({ name: "MARKET_DATA", passed: false, detail: error?.message || "market data unavailable" });
    }

    if (this.exirAdapter === null) {
      checks.push({ name: "EXIR_READ_ONLY_HEALTH", passed: false, detail: "Exir adapter is not configured" });
    } else {
      try {
        const balance = await this.exirAdapter.getBalance();
        const numericValues = flattenNumbers(balance);
        const hasNumericBalance = numericValues.some((value) => value >= this.minimumAvailableBalance);
        checks.push({
          name: "EXIR_READ_ONLY_HEALTH",
          passed: hasNumericBalance,
          detail: hasNumericBalance ? "read-only balance check succeeded" : "no usable balance value returned"
        });
      } catch (error) {
        checks.push({ name: "EXIR_READ_ONLY_HEALTH", passed: false, detail: error?.message || "Exir health check failed" });
      }
    }

    return Object.freeze({
      ready: checks.every((check) => check.passed),
      checks: Object.freeze(checks.map((check) => Object.freeze(check))),
      market,
      orderPlacementAttempted: false
    });
  }
}

function flattenNumbers(value) {
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(flattenNumbers);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenNumbers);
  return [];
}
