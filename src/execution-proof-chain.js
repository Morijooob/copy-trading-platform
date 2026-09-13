import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const clone = (value) => JSON.parse(JSON.stringify(value));

const fillHashFor = ({ fillId, idempotencyKey, exchangeOrderId, quantity, price }) =>
  hash({ fillId, idempotencyKey, exchangeOrderId, quantity, price });

export class ExecutionProofChain {
  constructor() {
    this.intents = new Map();
    this.fills = new Map();
    this.ledger = new Map();
    this.sequenceByMaster = new Map();
  }

  createIntent({ masterId, followerId, signalId, sequence, side, symbol, quantity, riskSnapshot }) {
    if (!masterId || !followerId || !signalId) throw new Error('identity_required');
    if (!Number.isInteger(sequence) || sequence < 1) throw new Error('invalid_sequence');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('invalid_quantity');
    if (!riskSnapshot?.version || !riskSnapshot?.hash) throw new Error('risk_snapshot_required');

    const idempotencyKey = `${masterId}:${followerId}:${signalId}:${sequence}`;
    const existing = this.intents.get(idempotencyKey);
    if (existing) {
      const samePayload = existing.side === side
        && existing.symbol === symbol
        && existing.quantity === quantity
        && existing.riskSnapshotVersion === riskSnapshot.version
        && existing.riskSnapshotHash === riskSnapshot.hash;
      if (!samePayload) throw new Error('conflicting_duplicate_intent');
      return { ...existing, duplicate: true };
    }

    const expected = (this.sequenceByMaster.get(masterId) || 0) + 1;
    if (sequence !== expected) throw new Error('non_monotonic_sequence');

    const intent = Object.freeze({
      idempotencyKey, masterId, followerId, signalId, sequence, side, symbol, quantity,
      riskSnapshotVersion: riskSnapshot.version, riskSnapshotHash: riskSnapshot.hash,
      intentHash: hash({ idempotencyKey, side, symbol, quantity, riskSnapshot }), status: 'admitted'
    });
    this.intents.set(idempotencyKey, intent);
    this.sequenceByMaster.set(masterId, sequence);
    return { ...intent, duplicate: false };
  }

  acknowledge({ idempotencyKey, exchangeOrderId, riskSnapshot, acknowledged = true }) {
    const intent = this.intents.get(idempotencyKey);
    if (!intent) throw new Error('intent_not_found');
    if (!acknowledged || !exchangeOrderId) throw new Error('exchange_ack_required');
    if (riskSnapshot?.version !== intent.riskSnapshotVersion || riskSnapshot?.hash !== intent.riskSnapshotHash) {
      throw new Error('risk_snapshot_mismatch');
    }
    const updated = Object.freeze({ ...intent, exchangeOrderId, status: 'acknowledged' });
    this.intents.set(idempotencyKey, updated);
    return updated;
  }

  recordFill({ idempotencyKey, exchangeOrderId, fillId, quantity, price }) {
    const intent = this.intents.get(idempotencyKey);
    if (!intent || intent.status !== 'acknowledged') throw new Error('ack_required_before_fill');
    if (intent.exchangeOrderId !== exchangeOrderId) throw new Error('order_binding_mismatch');
    if (!fillId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) throw new Error('invalid_fill');
    const existing = this.fills.get(fillId);
    if (existing) {
      const samePayload = existing.idempotencyKey === idempotencyKey
        && existing.exchangeOrderId === exchangeOrderId
        && existing.quantity === quantity
        && existing.price === price;
      if (!samePayload) throw new Error('conflicting_duplicate_fill');
      return { ...existing, duplicate: true };
    }
    const fill = Object.freeze({
      fillId, idempotencyKey, exchangeOrderId, quantity, price,
      fillHash: fillHashFor({ fillId, idempotencyKey, exchangeOrderId, quantity, price })
    });
    this.fills.set(fillId, fill);
    return { ...fill, duplicate: false };
  }

  reconcileLedger({ fillId, ledgerId }) {
    const fill = this.fills.get(fillId);
    if (!fill) throw new Error('fill_not_found');
    if (!ledgerId) throw new Error('ledger_id_required');
    const existing = this.ledger.get(fillId);
    if (existing) {
      if (existing.ledgerId !== ledgerId) return { ...existing, duplicate: true };
      return { ...existing, duplicate: true };
    }
    const entry = Object.freeze({ ledgerId, fillId, exchangeOrderId: fill.exchangeOrderId, fillHash: fill.fillHash });
    this.ledger.set(fillId, entry);
    return { ...entry, duplicate: false };
  }

  exportState() {
    return clone({
      version: 1,
      intents: [...this.intents.values()],
      fills: [...this.fills.values()],
      ledger: [...this.ledger.values()],
      sequenceByMaster: [...this.sequenceByMaster.entries()]
    });
  }

  static fromState(state) {
    if (!state || state.version !== 1 || !Array.isArray(state.intents) || !Array.isArray(state.fills)
      || !Array.isArray(state.ledger) || !Array.isArray(state.sequenceByMaster)) {
      throw new Error('invalid_proof_state');
    }
    const chain = new ExecutionProofChain();
    for (const intent of state.intents) chain.intents.set(intent.idempotencyKey, Object.freeze({ ...intent }));
    for (const fill of state.fills) chain.fills.set(fill.fillId, Object.freeze({ ...fill }));
    for (const entry of state.ledger) chain.ledger.set(entry.fillId, Object.freeze({ ...entry }));
    for (const [masterId, sequence] of state.sequenceByMaster) {
      if (!masterId || !Number.isInteger(sequence) || sequence < 0) throw new Error('invalid_proof_sequence');
      chain.sequenceByMaster.set(masterId, sequence);
    }
    return chain;
  }

  assertIntegrity() {
    for (const [fillId, fill] of this.fills) {
      if (!this.intents.has(fill.idempotencyKey)) throw new Error('orphan_fill');
      const expectedHash = fillHashFor(fill);
      if (fill.fillHash !== expectedHash) throw new Error('fill_hash_mismatch');
      const intent = this.intents.get(fill.idempotencyKey);
      if (intent.exchangeOrderId !== fill.exchangeOrderId) throw new Error('fill_order_binding_mismatch');
      const ledger = this.ledger.get(fillId);
      if (!ledger) throw new Error('ledger_reconciliation_missing');
      if (ledger.fillId !== fillId) throw new Error('ledger_fill_binding_mismatch');
      if (ledger.exchangeOrderId !== fill.exchangeOrderId) throw new Error('ledger_order_binding_mismatch');
      if (ledger.fillHash !== fill.fillHash) throw new Error('ledger_fill_hash_mismatch');
    }

    for (const [fillId, ledger] of this.ledger) {
      if (!this.fills.has(fillId)) throw new Error('orphan_ledger');
    }

    return { ok: true, intentCount: this.intents.size, fillCount: this.fills.size, ledgerCount: this.ledger.size };
  }

  assertReconciled(idempotencyKey) {
    const intent = this.intents.get(idempotencyKey);
    if (!intent) throw new Error('intent_not_found');
    const fills = [...this.fills.values()].filter((fill) => fill.idempotencyKey === idempotencyKey);
    if (fills.length === 0) throw new Error('fill_missing');
    if (fills.some((fill) => !this.ledger.has(fill.fillId))) throw new Error('ledger_reconciliation_missing');
    return { ok: true, intentHash: intent.intentHash, fillCount: fills.length };
  }
}
