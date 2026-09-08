export class VirtualExchange {
  constructor() {
    this.orders = new Map();
    this.nextOrder = 1;
  }

  submit({ clientOrderId, symbol, side, quantity, fills = [] }) {
    const existing = this.orders.get(clientOrderId);
    if (existing) return { ...existing, duplicate: true };

    const order = {
      orderId: `VEX-${String(this.nextOrder++).padStart(6, '0')}`,
      clientOrderId,
      symbol,
      side,
      requestedQuantity: quantity,
      filledQuantity: 0,
      fills: [],
      status: 'ACCEPTED'
    };
    this.orders.set(clientOrderId, order);
    if (fills.length) this.applyFills(clientOrderId, fills);
    return { ...this.orders.get(clientOrderId), duplicate: false };
  }

  applyFills(clientOrderId, fills) {
    const order = this.orders.get(clientOrderId);
    if (!order) throw new Error('Order not found');
    for (const fill of fills) {
      const remaining = order.requestedQuantity - order.filledQuantity;
      if (fill.quantity <= 0 || fill.quantity > remaining + 1e-12) throw new Error('Invalid fill quantity');
      order.fills.push({ ...fill });
      order.filledQuantity += fill.quantity;
    }
    order.status = order.filledQuantity >= order.requestedQuantity - 1e-12 ? 'FILLED' : 'PARTIALLY_FILLED';
    return { ...order, fills: [...order.fills] };
  }

  reconcile(clientOrderId) {
    const order = this.orders.get(clientOrderId);
    return order ? { ...order, fills: [...order.fills] } : null;
  }
}
