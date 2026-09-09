import crypto from "node:crypto";

const SENSITIVE_KEYS = /(?:api[_-]?key|secret|password|token|private[_-]?key|authorization|signature|credential)/i;

export class SecurityControl {
  constructor({ actorId = "system", role = "system", killSwitch = false, state = null } = {}) {
    this.actorId = String(actorId);
    this.role = String(role);
    this.killSwitch = Boolean(killSwitch);
    this.audit = [];
    this.sequence = 0;
    this.lastHash = "GENESIS";
    if (state !== null) this.restoreState(state);
  }

  authorize(action, { actorId = this.actorId, role = this.role } = {}) {
    const allowed = role === "admin" || role === "system";
    this.append("AUTH_CHECK", { action, actorId, role, allowed });
    if (!allowed) throw new Error("unauthorized security action");
    return true;
  }

  setKillSwitch(enabled, reason, { actorId = this.actorId, role = this.role } = {}) {
    this.authorize("KILL_SWITCH", { actorId, role });
    if (!reason || typeof reason !== "string") throw new Error("kill switch reason required");
    this.killSwitch = Boolean(enabled);
    this.append(this.killSwitch ? "KILL_SWITCH_ON" : "KILL_SWITCH_OFF", { actorId, reason: String(reason) });
    return this.killSwitch;
  }

  assertTradingAllowed(action = "TRADE") {
    if (this.killSwitch) {
      this.append("TRADE_BLOCKED", { action, reason: "KILL_SWITCH_ACTIVE" });
      throw new Error("trading blocked by kill switch");
    }
    return true;
  }

  auditEvent(type, payload = {}) {
    if (!type || typeof type !== "string") throw new Error("invalid audit event type");
    this.append(type, payload);
    return this.audit.at(-1).eventId;
  }

  append(type, payload) {
    const sanitized = redact(payload);
    const event = {
      eventId: String(++this.sequence),
      type,
      actorId: this.actorId,
      payload: sanitized,
      previousHash: this.lastHash
    };
    event.hash = hash(event);
    this.lastHash = event.hash;
    this.audit.push(event);
  }

  verifyAuditIntegrity() {
    let previousHash = "GENESIS";
    let expectedSequence = 1;
    for (const event of this.audit) {
      if (!event || event.eventId !== String(expectedSequence) || event.previousHash !== previousHash) return false;
      if (event.hash !== hash({ eventId: event.eventId, type: event.type, actorId: event.actorId, payload: event.payload, previousHash: event.previousHash })) return false;
      previousHash = event.hash;
      expectedSequence += 1;
    }
    return previousHash === this.lastHash && this.sequence === this.audit.length;
  }

  exportState() {
    return { actorId: this.actorId, role: this.role, killSwitch: this.killSwitch, sequence: this.sequence, lastHash: this.lastHash, audit: structuredClone(this.audit) };
  }

  restoreState(state) {
    if (!state || !Array.isArray(state.audit) || !Number.isInteger(state.sequence) || state.sequence < 0 || typeof state.lastHash !== "string") throw new Error("invalid security state");
    if (state.sequence !== state.audit.length) throw new Error("security audit sequence mismatch");
    this.actorId = String(state.actorId ?? this.actorId);
    this.role = String(state.role ?? this.role);
    this.killSwitch = Boolean(state.killSwitch);
    this.audit = structuredClone(state.audit);
    this.sequence = state.sequence;
    this.lastHash = state.lastHash;
    if (!this.verifyAuditIntegrity()) throw new Error("security audit integrity failure");
  }

  getAuditLog() { return structuredClone(this.audit); }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redact(child);
    return out;
  }
  return typeof value === "string" && value.length > 0 && SENSITIVE_KEYS.test(value) ? "[REDACTED]" : value;
}

function hash(event) {
  return crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");
}
