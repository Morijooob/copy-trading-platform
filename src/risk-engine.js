export class RiskEngine {
  constructor({ maxOrderNotional, maxDailyLoss, maxExposure, killSwitch = false, state = null } = {}) {
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
    if (state !== null) this.restore(state);
  }
  setKillSwitch(enabled, reason = "manual") { this.killSwitch = Boolean(enabled); this.audit.push({ type: this.killSwitch ? "KILL_SWITCH_ON" : "KILL_SWITCH_OFF", reason: String(reason) }); return this.killSwitch; }
  recordRealizedPnl(pnl) { if (!Number.isFinite(pnl)) throw new Error("invalid realized pnl"); if (pnl < 0) this.dailyRealizedLoss += Math.abs(pnl); return this.dailyRealizedLoss; }
  setExposure(exposure) { if (!Number.isFinite(exposure) || exposure < 0) throw new Error("invalid exposure"); if (exposure + this.reservedExposure > this.limits.maxExposure) throw new Error("exposure exceeds max exposure"); this.exposure = exposure; }
  approve({ side, quantity, price, currentExposure = this.exposure, realizedLoss = this.dailyRealizedLoss } = {}) { this.validateInputs({ side, quantity, price, currentExposure, realizedLoss }); const notional = quantity * price; const checks = this.checks({ notional, currentExposure, realizedLoss }); const failed = checks.filter(([, passed]) => !passed).map(([name]) => name); const result = { approved: failed.length === 0, notional, failedChecks: failed }; this.audit.push({ type: result.approved ? "RISK_APPROVED" : "RISK_REJECTED", ...result }); return result; }
  reserve({ side, quantity, price } = {}) {
    this.validateInputs({ side, quantity, price, currentExposure: this.exposure, realizedLoss: this.dailyRealizedLoss });
    const notional = quantity * price;
    const checks = this.checks({ notional, currentExposure: this.exposure + this.reservedExposure, realizedLoss: this.dailyRealizedLoss });
    const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
    if (failed.length) { const result = { approved: false, notional, failedChecks: failed, reservationId: null }; this.audit.push({ type: "RISK_RESERVATION_REJECTED", ...result }); return result; }
    const reservationId = `RISKRES-${this.nextReservationId++}`;
    this.reservations.set(reservationId, { notional, status: "RESERVED" });
    this.reservedExposure += notional;
    const result = { approved: true, notional, failedChecks: [], reservationId };
    this.audit.push({ type: "RISK_RESERVED", ...result });
    return result;
  }
  commitReservation(reservationId) { return this.settleReservation(reservationId); }
  settleReservation(reservationId, committedNotional = null) {
    const reservation = this.requireReservation(reservationId);
    const amount = committedNotional === null ? reservation.notional : committedNotional;
    if (!Number.isFinite(amount) || amount < 0 || amount > reservation.notional) throw new Error("invalid reservation settlement");
    if (amount === 0) return this.exposure;
    this.reservedExposure -= amount;
    this.exposure += amount;
    reservation.notional -= amount;
    if (reservation.notional === 0) reservation.status = "COMMITTED";
    this.audit.push({ type: reservation.status === "COMMITTED" ? "RISK_RESERVATION_COMMITTED" : "RISK_RESERVATION_PARTIALLY_COMMITTED", reservationId, notional: amount, remainingNotional: reservation.notional });
    return this.exposure;
  }
  releaseReservation(reservationId) { const reservation = this.requireReservation(reservationId); this.reservedExposure -= reservation.notional; reservation.status = "RELEASED"; this.audit.push({ type: "RISK_RESERVATION_RELEASED", reservationId, notional: reservation.notional }); return this.reservedExposure; }
  getReservation(reservationId) { const reservation = this.reservations.get(reservationId); return reservation ? structuredClone(reservation) : null; }
  exportState() { return { version: 1, limits: structuredClone(this.limits), killSwitch: this.killSwitch, dailyRealizedLoss: this.dailyRealizedLoss, exposure: this.exposure, reservedExposure: this.reservedExposure, nextReservationId: this.nextReservationId, reservations: [...this.reservations.entries()], audit: this.getAuditLog() }; }
  restore(state) {
    if (!state || state.version !== 1) throw new Error("unsupported risk state version");
    if (!state.limits || JSON.stringify(state.limits) !== JSON.stringify(this.limits)) throw new Error("risk limits mismatch");
    if (!Number.isInteger(state.nextReservationId) || state.nextReservationId < 1) throw new Error("invalid next reservation id");
    if (!Number.isFinite(state.dailyRealizedLoss) || state.dailyRealizedLoss < 0) throw new Error("invalid persisted daily loss");
    if (!Number.isFinite(state.exposure) || state.exposure < 0) throw new Error("invalid persisted exposure");
    if (!Number.isFinite(state.reservedExposure) || state.reservedExposure < 0) throw new Error("invalid persisted reserved exposure");
    if (!Array.isArray(state.reservations) || !Array.isArray(state.audit)) throw new Error("invalid persisted risk state");
    const reservations = new Map(); let reservedTotal = 0;
    for (const [id, raw] of state.reservations) {
      if (typeof id !== "string" || !raw || !Number.isFinite(raw.notional) || raw.notional < 0 || !["RESERVED", "COMMITTED", "RELEASED"].includes(raw.status)) throw new Error("invalid persisted reservation");
      if (reservations.has(id)) throw new Error("duplicate persisted reservation");
      reservations.set(id, structuredClone(raw)); if (raw.status === "RESERVED") reservedTotal += raw.notional;
    }
    if (Math.abs(reservedTotal - state.reservedExposure) > 1e-9) throw new Error("reserved exposure mismatch");
    if (state.exposure + state.reservedExposure > this.limits.maxExposure) throw new Error("persisted exposure exceeds max exposure");
    this.killSwitch = Boolean(state.killSwitch); this.dailyRealizedLoss = state.dailyRealizedLoss; this.exposure = state.exposure; this.reservedExposure = state.reservedExposure; this.nextReservationId = state.nextReservationId; this.reservations = reservations; this.audit = structuredClone(state.audit);
  }
  getAuditLog() { return structuredClone(this.audit); }
  validateInputs({ side, quantity, price, currentExposure, realizedLoss }) { if (side !== "BUY" && side !== "SELL") throw new Error("invalid side"); if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid quantity"); if (!Number.isFinite(price) || price <= 0) throw new Error("invalid price"); if (!Number.isFinite(currentExposure) || currentExposure < 0) throw new Error("invalid current exposure"); if (!Number.isFinite(realizedLoss) || realizedLoss < 0) throw new Error("invalid realized loss"); }
  checks({ notional, currentExposure, realizedLoss }) { return [["KILL_SWITCH", !this.killSwitch], ["ORDER_NOTIONAL", notional <= this.limits.maxOrderNotional], ["DAILY_LOSS", realizedLoss <= this.limits.maxDailyLoss], ["MAX_EXPOSURE", currentExposure + notional <= this.limits.maxExposure]]; }
  requireReservation(reservationId) { const reservation = this.reservations.get(reservationId); if (!reservation) throw new Error(`unknown reservation: ${reservationId}`); if (reservation.status !== "RESERVED") throw new Error(`reservation is ${reservation.status.toLowerCase()}`); return reservation; }
}
