const REQUIRED = Object.freeze([
  "backendOnlyExecution",
  "authenticatedSessions",
  "secureCookies",
  "twoFactorForRealTrading",
  "serverSideSecretStore",
  "withdrawalsDisabled",
  "killSwitch",
  "riskLimits",
  "idempotency",
  "auditIntegrity",
  "monitoringAndAlerts"
]);

export class ProductionSecurityGate {
  constructor(config = {}) {
    this.config = normalize(config);
  }

  evaluate() {
    const failed = REQUIRED.filter((key) => !this.config[key]);
    return Object.freeze({
      readyForRealMoney: failed.length === 0,
      failedControls: failed,
      requiredControls: [...REQUIRED]
    });
  }

  assertReadyForRealMoney() {
    const result = this.evaluate();
    if (!result.readyForRealMoney) {
      throw new Error(`real-money trading blocked: ${result.failedControls.join(",")}`);
    }
    return true;
  }

  publicState() {
    const result = this.evaluate();
    return { readyForRealMoney: result.readyForRealMoney, failedControls: result.failedControls };
  }
}

function normalize(config) {
  return Object.fromEntries(REQUIRED.map((key) => [key, config[key] === true]));
}
