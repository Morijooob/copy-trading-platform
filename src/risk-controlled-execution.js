export class RiskControlledExecution {
  constructor({ riskEngine, executionEngine }) {
    if (!riskEngine || typeof riskEngine.reserve !== "function") throw new Error("invalid risk engine");
    if (!executionEngine || typeof executionEngine.createOrder !== "function") throw new Error("invalid execution engine");
    this.riskEngine = riskEngine;
    this.executionEngine = executionEngine;
    this.audit = [];
  }

  submit({ symbol, side, quantity, price, timeoutMs = 5000, clientOrderId = null, eventSequence = null } = {}) {
    const decision = this.riskEngine.reserve({ side, quantity, price });
    const entry = { symbol, side, quantity, price, clientOrderId, approved: decision.approved, failedChecks: [...decision.failedChecks], notional: decision.notional, reservationId: decision.reservationId };

    if (!decision.approved) {
      entry.execution = "BLOCKED";
      this.audit.push(structuredClone(entry));
      return { accepted: false, risk: structuredClone(decision), order: null };
    }

    try {
      const order = this.executionEngine.createOrder({ symbol, side, quantity, timeoutMs, clientOrderId, eventSequence });
      this.riskEngine.commitReservation(decision.reservationId);
      entry.execution = "COMMITTED";
      this.audit.push(structuredClone(entry));
      return { accepted: true, risk: structuredClone(decision), order };
    } catch (error) {
      this.riskEngine.releaseReservation(decision.reservationId);
      entry.execution = "FAILED_RELEASED";
      entry.error = error instanceof Error ? error.message : String(error);
      this.audit.push(structuredClone(entry));
      throw error;
    }
  }

  getAuditLog() {
    return structuredClone(this.audit);
  }
}
