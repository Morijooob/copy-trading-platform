export class RiskReservation {
  constructor({ riskEngine, reservationId, notional }) {
    this.riskEngine = riskEngine;
    this.reservationId = reservationId;
    this.notional = notional;
    this.active = true;
  }

  commit() {
    if (!this.active) throw new Error("reservation is not active");
    this.riskEngine.commitReservation(this.reservationId);
    this.active = false;
    return true;
  }

  release() {
    if (!this.active) return false;
    this.riskEngine.releaseReservation(this.reservationId);
    this.active = false;
    return true;
  }
}
