export class AtomicWalletStore {
  #ledger;
  #stateStore;
  #lock = Promise.resolve();

  constructor({ ledger, stateStore }) {
    if (!ledger || !stateStore || typeof stateStore.save !== 'function') {
      throw new Error('ledger and durable stateStore are required');
    }
    this.#ledger = ledger;
    this.#stateStore = stateStore;
  }

  async transact(operation) {
    return this.#enqueue(async () => {
      const before = this.#ledger.snapshot();
      const result = await operation(this.#ledger);
      try {
        await this.#stateStore.save({ walletLedger: this.#ledger.snapshot() });
      } catch (error) {
        this.#restoreLedger(before);
        throw new Error(`wallet transaction persistence failed: ${error.message}`);
      }
      return result;
    });
  }

  snapshot() {
    return this.#ledger.snapshot();
  }

  #enqueue(operation) {
    const run = this.#lock.then(operation, operation);
    this.#lock = run.catch(() => undefined);
    return run;
  }

  #restoreLedger(snapshot) {
    if (typeof this.#ledger.restore !== 'function') {
      throw new Error('ledger restore capability is required for atomic rollback');
    }
    this.#ledger.restore(snapshot);
  }
}
