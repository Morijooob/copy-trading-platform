import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

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
    if (this.fills.has(fillId)) return { ...this.fills.get(fillId), duplicate: true };
    const fill = Object.freeze({ fillId, idempotencyKey, exchangeOrderId, quantity, price, fillHash: hash({ fillId, idempotencyKey, exchangeOrderId, quantity, price }) });
    this.fills.set(fillId, fill);
    return { ...fill, duplicate: false };
  }

  reconcileLedger({ fillId, ledgerId }) {
    const fill = this.fills.get(fillId);
    if (!fill) throw new Error('fill_not_found');
    if (this.ledger.has(fillId)) return { ...this.ledger.get(fillId), duplicate: true };
    const entry = Object.freeze({ ledgerId, fillId, exchangeOrderId: fill.exchangeOrderId, fillHash: fill.fillHash });
    this.ledger.set(fillId, entry);
    return { ...entry, duplicate: false };
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
