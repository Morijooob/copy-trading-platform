export class Ledger {
  constructor(initialBalance = 0) {
    this.balance = initialBalance;
    this.availableBalance = initialBalance;
    this.positions = new Map();
    this.realizedPnl = 0;
    this.fees = 0;
  }

  applyFill({ symbol, side, quantity, price, fee = 0 }) {
    if (quantity <= 0 || price <= 0) throw new Error('Invalid fill');
    const notional = quantity * price;
    this.fees += fee;
    if (side === 'BUY') {
      this.availableBalance -= notional + fee;
      const current = this.positions.get(symbol) ?? { quantity: 0, cost: 0 };
      current.quantity += quantity;
      current.cost += notional;
      this.positions.set(symbol, current);
    } else if (side === 'SELL') {
      const current = this.positions.get(symbol) ?? { quantity: 0, cost: 0 };
      if (quantity > current.quantity + 1e-12) throw new Error('Negative position prevented');
      const avgCost = current.quantity === 0 ? 0 : current.cost / current.quantity;
      this.realizedPnl += (price - avgCost) * quantity - fee;
      current.quantity -= quantity;
      current.cost -= avgCost * quantity;
      if (current.quantity <= 1e-12) this.positions.delete(symbol);
      else this.positions.set(symbol, current);
      this.availableBalance += notional - fee;
    } else {
      throw new Error(`Unsupported side: ${side}`);
    }
    if (this.availableBalance < -1e-9) throw new Error('Negative balance prevented');
  }

  position(symbol) {
    return this.positions.get(symbol)?.quantity ?? 0;
  }
}
