export class SecurityControlledExecution {
  constructor({ securityControl, execution }) {
    if (!securityControl || typeof securityControl.assertTradingAllowed !== "function") throw new Error("invalid security control");
    if (!execution || typeof execution.submit !== "function") throw new Error("invalid execution controller");
    this.securityControl = securityControl;
    this.execution = execution;
  }

  submit(request) {
    this.securityControl.assertTradingAllowed("SUBMIT_ORDER");
    const result = this.execution.submit(request);
    this.securityControl.auditEvent("ORDER_SUBMITTED", {
      clientOrderId: request?.clientOrderId ?? null,
      symbol: request?.symbol ?? null,
      side: request?.side ?? null,
      quantity: request?.quantity ?? null,
      price: request?.price ?? null
    });
    return result;
  }

  setKillSwitch(enabled, reason, actor) {
    return this.securityControl.setKillSwitch(enabled, reason, actor);
  }

  exportState() {
    return { security: this.securityControl.exportState(), execution: this.execution.exportState?.() };
  }
}
