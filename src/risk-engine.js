export class RiskEngine {
  constructor({ maxOrderNotional, maxDailyLoss, maxExposure, killSwitch = false } = {}) {
    if (!Number.isFinite(maxOrderNotional) || maxOrderNotional <= 0) throw new Error("invalid max order notional");
    if (!Number.isFinite(maxDailyLoss) || maxDailyLoss < 0) throw new Error("invalid max daily loss");
    if (!Number.isFinite(maxExposure) || maxExposure <= 0) throw new Error("invalid max exposure");
    this.limits = { maxOrderNotional, maxDailyLoss, maxExposure };
    this.killSwitch = Boolean(killSwitch);
    this.dailyRealizedLoss = 0;
    this.exposure = 0;
    this.reservedExposure = 0;
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

  reserveExposure(notional) {
    if (!Number.isFinite(notional) || notional <= 0) throw new Error("invalid exposure reservation");
    if (this.exposure + this.reservedExposure + notional > this.limits.maxExposure) throw new Error("max exposure exceeded");
    this.reservedExposure += notional;
    this.audit.push({ type: "EXPOSURE_RESERVED", notional, reservedExposure: this.reservedExposure });
    return this.reservedExposure;
  }

  releaseExposure(notional) {
    if (!Number.isFinite(notional) || notional <= 0) throw new Error("invalid exposure release");
    if (notional > this.reservedExposure) throw new Error("exposure release exceeds reservation");
    this.reservedExposure -= notional;
    this.audit.push({ type: "EXPOSURE_RELEASED", notional, reservedExposure: this.reservedExposure });
    return this.reservedExposure;
  }

  commitReservedExposure(notional) {
    if (!Number.isFinite(notional) || notional <= 0) throw new Error("invalid exposure commit");
    if (notional > this.reservedExposure) throw new Error("exposure commit exceeds reservation");
    this.reservedExposure -= notional;
    this.exposure += notional;
    if (this.exposure + this.reservedExposure > this.limits.maxExposure) {
      this.reservedExposure += notional;
      this.exposure -= notional;
      throw new Error("max exposure exceeded");
    }
    this.audit.push({ type: "EXPOSURE_COMMITTED", notional, exposure: this.exposure, reservedExposure: this.reservedExposure });
    return { exposure: this.exposure, reservedExposure: this.reservedExposure };
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
      ["DAILY_LOSS", realizedLoss < this.limits.maxDailyLoss],
      ["MAX_EXPOSURE", currentExposure + this.reservedExposure + notional <= this.limits.maxExposure]
    ];
    const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
    const result = { approved: failed.length === 0, notional, failedChecks: failed };
    this.audit.push({ type: result.approved ? "RISK_APPROVED" : "RISK_REJECTED", ...result });
    return result;
  }

  getAuditLog() { return structuredClone(this.audit); }
}
