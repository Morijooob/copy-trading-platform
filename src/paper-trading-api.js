const crypto = require('node:crypto');

class PaperTradingApi {
  constructor({ paperExchange, copyExecution, accounts = [] } = {}) {
    if (!paperExchange) throw new Error('paperExchange is required');
    this.paperExchange = paperExchange;
    this.copyExecution = copyExecution || null;
    this.accounts = new Map(accounts.map((a) => [a.accountId, a]));
    this.sessions = new Map();
  }

  createSession({ accountId }) {
    if (!this.accounts.has(accountId)) throw new Error('unknown account');
    const token = crypto.randomBytes(24).toString('hex');
    this.sessions.set(token, { accountId, createdAt: Date.now() });
    return { token, accountId };
  }

  authenticate(token) {
    const session = this.sessions.get(token);
    if (!session) throw new Error('unauthorized');
    return session;
  }

  async placeOrder({ token, symbol, side, quantity, price, clientOrderId }) {
    const session = this.authenticate(token);
    if (!symbol || !['BUY', 'SELL'].includes(side)) throw new Error('invalid order');
    if (!(Number(quantity) > 0) || !(Number(price) > 0)) throw new Error('invalid order size');
    const id = clientOrderId || `paper:${session.accountId}:${crypto.randomUUID()}`;
    const result = this.paperExchange.submitOrder({
      accountId: session.accountId, symbol, side,
      quantity: Number(quantity), price: Number(price), clientOrderId: id
    });
    return { accountId: session.accountId, ...result };
  }

  getOrder({ token, clientOrderId }) {
    const session = this.authenticate(token);
    const order = this.paperExchange.getOrder(clientOrderId);
    if (!order || order.accountId !== session.accountId) throw new Error('order not found');
    return order;
  }

  listOrders({ token }) {
    const session = this.authenticate(token);
    return this.paperExchange.snapshot().orders.filter((o) => o.accountId === session.accountId);
  }

  dashboard({ token }) {
    const session = this.authenticate(token);
    const orders = this.listOrders({ token });
    const filledNotional = orders.reduce((sum, o) => sum + Number(o.filledQuantity || 0) * Number(o.averageFillPrice || 0), 0);
    return { accountId: session.accountId, mode: 'PAPER', orderCount: orders.length, filledNotional, orders };
  }
}

module.exports = { PaperTradingApi };