export class RiskControlledExecution {
  constructor({ riskEngine, executionEngine }) {
    if (!riskEngine || typeof riskEngine.approve !== "function") throw new Error("invalid risk engine");
    if (!executionEngine || typeof executionEngine.createOrder !== "function") throw new Error("invalid execution engine");
    this.riskEngine = riskEngine;
    this.executionEngine = executionEngine;
    this.audit = [];
  }

  submit({ symbol, side, quantity, price, timeoutMs = 5000, clientOrderId = null, eventSequence = null } = {}) {
    const decision = this.riskEngine.approve({ side, quantity, price });
    const entry = { symbol, side, quantity, price, clientOrderId, approved: decision.approved, failedChecks: [...decision.failedChecks], notional: decision.notional };
    this.audit.push(structuredClone(entry));

    if (!decision.approved) {
      return { accepted: false, risk: structuredClone(decision), order: null };
    }

    const order = this.executionEngine.createOrder({ symbol, side, quantity, timeoutMs, clientOrderId, eventSequence });
    return { accepted: true, risk: structuredClone(decision), order };
  }

  getAuditLog() {
    return structuredClone(this.audit);
  }
}
