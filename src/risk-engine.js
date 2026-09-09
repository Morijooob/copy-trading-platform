export class RiskEngine {
  constructor({ maxOrderNotional, maxDailyLoss, maxExposure, killSwitch = false } = {}) {
    if (!Number.isFinite(maxOrderNotional) || maxOrderNotional <= 0) throw new Error("invalid max order notional");
    if (!Number.isFinite(maxDailyLoss) || maxDailyLoss < 0) throw new Error("invalid max daily loss");
    if (!Number.isFinite(maxExposure) || maxExposure <= 0) throw new Error("invalid max exposure");
    this.limits = { maxOrderNotional, maxDailyLoss, maxExposure };
    this.killSwitch = Boolean(killSwitch);
    this.dailyRealizedLoss = 0;
    this.exposure = 0;
    this.audit = [];
  }

  setKillSwitch(enabled, reason = "manual") {
    this.killSwitch = Boolean(enabled);
    this.audit.push({ type: this.killSwitch ? "KILL_SWITCH_ON" : "KILL_SWITCH_OFF", reason: String(reason) });
    return this.killSwitch;
  }

  recordRealizedPnl(pnl) {
    if (!Number.isFinite(pnl)) throw new Error("invalid realized pnl");
    if (pnl < 0) this.dailyRealizedLoss += Math.abs(pnl);
    return this.dailyRealizedLoss;
  }

  setExposure(exposure) {
    if (!Number.isFinite(exposure) || exposure < 0) throw new Error("invalid exposure");
    this.exposure = exposure;
  }

  approve({ side, quantity, price, currentExposure = this.exposure, realizedLoss = this.dailyRealizedLoss } = {}) {
    if (side !== "BUY" && side !== "SELL") throw new Error("invalid side");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid quantity");
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid price");
    if (!Number.isFinite(currentExposure) || currentExposure < 0) throw new Error("invalid current exposure");
    if (!Number.isFinite(realizedLoss) || realizedLoss < 0) throw new Error("invalid realized loss");

    const notional = quantity * price;
    const checks = [
      ["KILL_SWITCH", !this.killSwitch],
      ["ORDER_NOTIONAL", notional <= this.limits.maxOrderNotional],
      ["DAILY_LOSS", realizedLoss <= this.limits.maxDailyLoss],
      ["MAX_EXPOSURE", currentExposure + notional <= this.limits.maxExposure]
    ];
    const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
    const result = { approved: failed.length === 0, notional, failedChecks: failed };
    this.audit.push({ type: result.approved ? "RISK_APPROVED" : "RISK_REJECTED", ...result });
    return result;
  }

  getAuditLog() { return structuredClone(this.audit); }
}
