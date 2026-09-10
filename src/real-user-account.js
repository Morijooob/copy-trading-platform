import crypto from "node:crypto";

export const ACCOUNT_STATES = Object.freeze({
  PENDING: "PENDING",
  DEMO_ONLY: "DEMO_ONLY",
  READY_FOR_REAL: "READY_FOR_REAL",
  DISABLED: "DISABLED"
});

export class RealUserAccount {
  constructor({ userId, exchange, apiKey, apiSecret, permissions = {} } = {}) {
    if (!userId || !exchange || !apiKey || !apiSecret) throw new Error("userId, exchange, apiKey and apiSecret are required");
    this.userId = String(userId);
    this.exchange = String(exchange);
    this.apiKeyHash = fingerprint(apiKey);
    this.apiSecretHash = fingerprint(apiSecret);
    this.permissions = normalizePermissions(permissions);
    this.state = ACCOUNT_STATES.PENDING;
    this.demoEnabled = false;
    this.realEnabled = false;
  }

  enableDemo() {
    if (this.state === ACCOUNT_STATES.DISABLED) throw new Error("account disabled");
    this.demoEnabled = true;
    this.state = ACCOUNT_STATES.DEMO_ONLY;
    return true;
  }

  validateForReal({ connectionOk = false, permissions = this.permissions } = {}) {
    if (this.state === ACCOUNT_STATES.DISABLED) throw new Error("account disabled");
    const p = normalizePermissions(permissions);
    if (!connectionOk) throw new Error("exchange connection not verified");
    if (!p.read) throw new Error("read permission required");
    if (!p.trade) throw new Error("trading permission required");
    if (p.withdraw) throw new Error("withdrawal permission is forbidden");
    this.permissions = p;
    this.state = ACCOUNT_STATES.READY_FOR_REAL;
    return true;
  }

  enableReal() {
    if (this.state !== ACCOUNT_STATES.READY_FOR_REAL) throw new Error("real trading is not unlocked");
    this.realEnabled = true;
    return true;
  }

  disableReal() {
    this.realEnabled = false;
    if (this.state === ACCOUNT_STATES.READY_FOR_REAL) this.state = ACCOUNT_STATES.DEMO_ONLY;
  }

  canTradeReal() {
    return this.realEnabled && this.state === ACCOUNT_STATES.READY_FOR_REAL && !this.permissions.withdraw;
  }

  publicState() {
    return {
      userId: this.userId,
      exchange: this.exchange,
      state: this.state,
      demoEnabled: this.demoEnabled,
      realEnabled: this.realEnabled,
      permissions: { read: this.permissions.read, trade: this.permissions.trade, withdraw: false },
      credentialFingerprint: this.apiKeyHash
    };
  }
}

function normalizePermissions(p) {
  return { read: Boolean(p?.read), trade: Boolean(p?.trade), withdraw: Boolean(p?.withdraw) };
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
