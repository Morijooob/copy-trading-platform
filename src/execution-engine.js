export class ExecutionEngine {
  constructor() {
    this.orders = new Map();
    this.ordersByClientId = new Map();
    this.nextId = 1;
  }

  createOrder({ symbol, side, quantity, timeoutMs = 5000, clientOrderId = null }) {
    if (!symbol || !side || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("invalid order");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("invalid timeout");
    }
    if (clientOrderId !== null && (!clientOrderId || typeof clientOrderId !== "string")) {
      throw new Error("invalid client order id");
    }

    if (clientOrderId !== null && this.ordersByClientId.has(clientOrderId)) {
      const existing = this.orders.get(this.ordersByClientId.get(clientOrderId));
      if (
        existing.symbol !== symbol ||
        existing.side !== side ||
        existing.requestedQty !== quantity ||
        existing.timeoutMs !== timeoutMs
      ) {
        throw new Error("conflicting client order id");
      }
      return this.snapshot(existing);
    }

    const id = String(this.nextId++);
    const order = {
      id,
      clientOrderId,
      symbol,
      side,
      requestedQty: quantity,
      filledQty: 0,
      status: "PENDING",
      timeoutMs,
      elapsedMs: 0,
      recovered: false,
      processedFillIds: new Map()
    };
    this.orders.set(id, order);
    if (clientOrderId !== null) this.ordersByClientId.set(clientOrderId, id);
    return this.snapshot(order);
  }

  onExchangeFill(id, quantity, fillId = null) {
    const order = this.require(id);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("invalid fill");
    }

    if (fillId !== null) {
      const previousQuantity = order.processedFillIds.get(fillId);
      if (previousQuantity !== undefined) {
        if (previousQuantity !== quantity) {
          throw new Error("conflicting fill id");
        }
        return this.snapshot(order);
      }
      order.processedFillIds.set(fillId, quantity);
    }

    order.filledQty = Math.min(order.requestedQty, order.filledQty + quantity);
    order.status = order.filledQty === order.requestedQty ? "FILLED" : "PARTIAL";
    return this.snapshot(order);
  }

  tick(id, elapsedMs) {
    const order = this.require(id);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new Error("invalid elapsed time");
    }

    order.elapsedMs += elapsedMs;

    if (order.filledQty === order.requestedQty) {
      order.status = "FILLED";
    } else if (order.elapsedMs >= order.timeoutMs) {
      order.status = "TIMED_OUT";
    }
    return this.snapshot(order);
  }

  crash(id) {
    const order = this.require(id);
    if (order.status !== "FILLED") order.status = "CRASHED";
    return this.snapshot(order);
  }

  recover(id) {
    const order = this.require(id);
    if (order.status !== "CRASHED" && order.status !== "TIMED_OUT") {
      return this.snapshot(order);
    }

    order.recovered = true;
    if (order.filledQty === order.requestedQty) {
      order.status = "FILLED";
    } else if (order.filledQty > 0) {
      order.status = "PARTIAL";
    } else {
      order.status = "PENDING";
    }
    return this.snapshot(order);
  }

  require(id) {
    const order = this.orders.get(id);
    if (!order) throw new Error(`unknown order: ${id}`);
    return order;
  }

  snapshot(order) {
    const snapshot = structuredClone(order);
    delete snapshot.processedFillIds;
    return snapshot;
  }
}
