export class PaperExchange {
  constructor({ clock = () => Date.now(), latencyMs = 0 } = {}) {
    this.clock = clock;
    this.latencyMs = latencyMs;
    this.orders = new Map();
    this.nextOrderId = 1;
  }

  submitOrder(order) {
    if (!order?.clientOrderId) throw new Error('clientOrderId required');
    const existing = this.orders.get(order.clientOrderId);
    if (existing) {
      if (JSON.stringify(existing.request) !== JSON.stringify(order)) {
        throw new Error('conflicting clientOrderId');
      }
      return this.snapshot(existing);
    }

    const record = {
      exchangeOrderId: `paper-${this.nextOrderId++}`,
      clientOrderId: order.clientOrderId,
      request: { ...order },
      status: 'OPEN',
      filledQuantity: 0,
      averageFillPrice: null,
      createdAt: this.clock(),
      updatedAt: this.clock(),
    };
    this.orders.set(order.clientOrderId, record);
    return this.snapshot(record);
  }

  fillOrder(clientOrderId, quantity, price) {
    const record = this.orders.get(clientOrderId);
    if (!record) throw new Error('order not found');
    if (record.status === 'FILLED' || record.status === 'CANCELED' || record.status === 'REJECTED') {
      throw new Error(`cannot fill terminal order: ${record.status}`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('invalid fill quantity');
    if (!Number.isFinite(price) || price <= 0) throw new Error('invalid fill price');

    const total = record.filledQuantity + quantity;
    const requested = Number(record.request.quantity);
    if (!Number.isFinite(requested) || requested <= 0) throw new Error('invalid requested quantity');
    if (total > requested) throw new Error('fill exceeds requested quantity');

    const previousValue = record.filledQuantity * (record.averageFillPrice ?? price);
    record.filledQuantity = total;
    record.averageFillPrice = (previousValue + quantity * price) / total;
    record.status = total === requested ? 'FILLED' : 'PARTIALLY_FILLED';
    record.updatedAt = this.clock();
    return this.snapshot(record);
  }

  cancelOrder(clientOrderId) {
    const record = this.orders.get(clientOrderId);
    if (!record) throw new Error('order not found');
    if (record.status === 'FILLED') throw new Error('cannot cancel filled order');
    if (record.status !== 'CANCELED') {
      record.status = 'CANCELED';
      record.updatedAt = this.clock();
    }
    return this.snapshot(record);
  }

  reconcile(clientOrderId) {
    const record = this.orders.get(clientOrderId);
    if (!record) return { confirmed: false };
    return { confirmed: true, exchangeOrderId: record.exchangeOrderId, state: this.snapshot(record) };
  }

  getOrder(clientOrderId) {
    const record = this.orders.get(clientOrderId);
    return record ? this.snapshot(record) : null;
  }

  snapshot(record) {
    return {
      exchangeOrderId: record.exchangeOrderId,
      clientOrderId: record.clientOrderId,
      status: record.status,
      filledQuantity: record.filledQuantity,
      averageFillPrice: record.averageFillPrice,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
