const DEFAULTS = Object.freeze({
  killSwitch: false,
  maxOrderNotional: 1000,
  maxDailyLoss: 200,
  maxExposure: 1500,
  monitoringHeartbeatMaxAgeMs: 60_000
});

export class OperationalSafety {
  constructor(config = {}) {
    this.config = normalize(config);
    this.alerts = [];
    this.lastHeartbeatAt = null;
  }

  setKillSwitch(enabled, reason = "") {
    this.config.killSwitch = Boolean(enabled);
    this.config.killSwitchReason = String(reason || "");
    this.recordAlert(this.config.killSwitch ? "KILL_SWITCH_ENABLED" : "KILL_SWITCH_DISABLED", this.config.killSwitchReason);
    return this.publicState();
  }

  heartbeat(at = Date.now()) {
    const value = Number(at);
    if (!Number.isFinite(value)) throw new Error("invalid heartbeat timestamp");
    this.lastHeartbeatAt = value;
    return { ok: true, at: value };
  }

  monitoringHealthy(now = Date.now()) {
    if (this.lastHeartbeatAt === null) return false;
    return Number(now) - this.lastHeartbeatAt <= this.config.monitoringHeartbeatMaxAgeMs;
  }

  assertExecutionAllowed({ notional = 0, dailyLoss = 0, exposure = 0 } = {}) {
    const failed = [];
    if (this.config.killSwitch) failed.push("KILL_SWITCH");
    if (!(Number.isFinite(notional) && notional >= 0) || notional > this.config.maxOrderNotional) failed.push("ORDER_NOTIONAL");
    if (!(Number.isFinite(dailyLoss) && dailyLoss >= 0) || dailyLoss > this.config.maxDailyLoss) failed.push("DAILY_LOSS");
    if (!(Number.isFinite(exposure) && exposure >= 0) || exposure > this.config.maxExposure) failed.push("MAX_EXPOSURE");
    return { allowed: failed.length === 0, failedChecks: failed };
  }

  recordAlert(type, detail = "") {
    const entry = Object.freeze({ type: String(type), detail: String(detail), at: new Date().toISOString() });
    this.alerts.push(entry);
    return entry;
  }

  getAlerts() { return this.alerts.map((entry) => ({ ...entry })); }

  publicState() {
    return {
      killSwitch: this.config.killSwitch,
      killSwitchReason: this.config.killSwitchReason,
      maxOrderNotional: this.config.maxOrderNotional,
      maxDailyLoss: this.config.maxDailyLoss,
      maxExposure: this.config.maxExposure,
      monitoringHealthy: this.monitoringHealthy()
    };
  }
}

function normalize(config) {
  return {
    ...DEFAULTS,
    killSwitchReason: "",
    ...config,
    killSwitch: Boolean(config.killSwitch),
    maxOrderNotional: finitePositive(config.maxOrderNotional ?? DEFAULTS.maxOrderNotional),
    maxDailyLoss: finitePositive(config.maxDailyLoss ?? DEFAULTS.maxDailyLoss),
    maxExposure: finitePositive(config.maxExposure ?? DEFAULTS.maxExposure),
    monitoringHeartbeatMaxAgeMs: finitePositive(config.monitoringHeartbeatMaxAgeMs ?? DEFAULTS.monitoringHeartbeatMaxAgeMs)
  };
}

function finitePositive(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error("safety limit must be positive");
  return number;
}
