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
    this.reservations = new Map();
    this.nextReservationId = 1;
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
    if (exposure + this.reservedExposure > this.limits.maxExposure) throw new Error("exposure exceeds max exposure");
    this.exposure = exposure;
  }

  approve({ side, quantity, price, currentExposure = this.exposure, realizedLoss = this.dailyRealizedLoss } = {}) {
    this.validateInputs({ side, quantity, price, currentExposure, realizedLoss });
    const notional = quantity * price;
    const checks = this.checks({ notional, currentExposure, realizedLoss });
    const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
    const result = { approved: failed.length === 0, notional, failedChecks: failed };
    this.audit.push({ type: result.approved ? "RISK_APPROVED" : "RISK_REJECTED", ...result });
    return result;
  }

  reserve({ side, quantity, price } = {}) {
    this.validateInputs({ side, quantity, price, currentExposure: this.exposure, realizedLoss: this.dailyRealizedLoss });
    const notional = quantity * price;
    const checks = this.checks({ notional, currentExposure: this.exposure + this.reservedExposure, realizedLoss: this.dailyRealizedLoss });
    const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
    if (failed.length) {
      const result = { approved: false, notional, failedChecks: failed, reservationId: null };
      this.audit.push({ type: "RISK_RESERVATION_REJECTED", ...result });
      return result;
    }

    const reservationId = `RISKRES-${this.nextReservationId++}`;
    this.reservations.set(reservationId, { notional, status: "RESERVED" });
    this.reservedExposure += notional;
    const result = { approved: true, notional, failedChecks: [], reservationId };
    this.audit.push({ type: "RISK_RESERVED", ...result });
    return result;
  }

  commitReservation(reservationId) {
    const reservation = this.requireReservation(reservationId);
    this.reservedExposure -= reservation.notional;
    this.exposure += reservation.notional;
    reservation.status = "COMMITTED";
    this.audit.push({ type: "RISK_RESERVATION_COMMITTED", reservationId, notional: reservation.notional });
    return this.exposure;
  }

  releaseReservation(reservationId) {
    const reservation = this.requireReservation(reservationId);
    this.reservedExposure -= reservation.notional;
    reservation.status = "RELEASED";
    this.audit.push({ type: "RISK_RESERVATION_RELEASED", reservationId, notional: reservation.notional });
    return this.reservedExposure;
  }

  getReservation(reservationId) {
    const reservation = this.reservations.get(reservationId);
    return reservation ? structuredClone(reservation) : null;
  }

  getAuditLog() { return structuredClone(this.audit); }

  validateInputs({ side, quantity, price, currentExposure, realizedLoss }) {
    if (side !== "BUY" && side !== "SELL") throw new Error("invalid side");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid quantity");
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid price");
    if (!Number.isFinite(currentExposure) || currentExposure < 0) throw new Error("invalid current exposure");
    if (!Number.isFinite(realizedLoss) || realizedLoss < 0) throw new Error("invalid realized loss");
  }

  checks({ notional, currentExposure, realizedLoss }) {
    return [
      ["KILL_SWITCH", !this.killSwitch],
      ["ORDER_NOTIONAL", notional <= this.limits.maxOrderNotional],
      ["DAILY_LOSS", realizedLoss <= this.limits.maxDailyLoss],
      ["MAX_EXPOSURE", currentExposure + notional <= this.limits.maxExposure]
    ];
  }

  requireReservation(reservationId) {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error(`unknown reservation: ${reservationId}`);
    if (reservation.status !== "RESERVED") throw new Error(`reservation is ${reservation.status.toLowerCase()}`);
    return reservation;
  }
}
