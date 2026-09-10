export class WalletLedger {
  constructor() {
    this.accounts = new Map();
    this.entries = [];
  }

  ensureUser(userId) {
    if (!userId) throw new Error('userId required');
    if (!this.accounts.has(userId)) this.accounts.set(userId, new Map());
    return this.accounts.get(userId);
  }

  balance(userId, asset = 'USDT') {
    return this.ensureUser(userId).get(asset) || 0;
  }

  credit(userId, asset, amount, reference) {
    this.#assertAmount(amount);
    const a = this.ensureUser(userId);
    a.set(asset, this.balance(userId, asset) + amount);
    this.#entry('credit', userId, asset, amount, reference);
    return this.balance(userId, asset);
  }

  debit(userId, asset, amount, reference) {
    this.#assertAmount(amount);
    const current = this.balance(userId, asset);
    if (current < amount) throw new Error('insufficient balance');
    this.ensureUser(userId).set(asset, current - amount);
    this.#entry('debit', userId, asset, amount, reference);
    return this.balance(userId, asset);
  }

  recordProfit(userId, asset, grossProfit, commission, reference) {
    if (grossProfit < 0 || commission < 0 || commission > grossProfit) throw new Error('invalid profit/commission');
    if (grossProfit) this.credit(userId, asset, grossProfit, `${reference}:gross-profit`);
    if (commission) this.debit(userId, asset, commission, `${reference}:commission`);
    this.#entry('commission', userId, asset, commission, reference);
    return { grossProfit, commission, netProfit: grossProfit - commission, balance: this.balance(userId, asset) };
  }

  snapshot() {
    return {
      accounts: Object.fromEntries([...this.accounts].map(([u, assets]) => [u, Object.fromEntries(assets)])),
      entries: [...this.entries]
    };
  }

  #entry(type, userId, asset, amount, reference) {
    this.entries.push(Object.freeze({ id: `${Date.now()}-${this.entries.length + 1}`, type, userId, asset, amount, reference, at: new Date().toISOString() }));
  }

  #assertAmount(amount) {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be positive');
  }
}
