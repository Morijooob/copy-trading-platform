export class ExecutionEngine {
  constructor() {
    this.orders = new Map();
    this.nextId = 1;
  }

  createOrder({ symbol, side, quantity, timeoutMs = 5000 }) {
    if (!symbol || !side || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("invalid order");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("invalid timeout");
    }

    const id = String(this.nextId++);
    const order = {
      id,
      symbol,
      side,
      requestedQty: quantity,
      filledQty: 0,
      status: "PENDING",
      timeoutMs,
      elapsedMs: 0,
      recovered: false,
      processedFillIds: new Set()
    };
    this.orders.set(id, order);
    return this.snapshot(order);
  }

  onExchangeFill(id, quantity, fillId = null) {
    const order = this.require(id);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("invalid fill");
    }

    if (fillId !== null) {
      if (order.processedFillIds.has(fillId)) {
        return this.snapshot(order);
      }
      order.processedFillIds.add(fillId);
    }

    if (order.status === "CRASHED" || order.status === "TIMED_OUT") {
      return this.snapshot(order);
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
