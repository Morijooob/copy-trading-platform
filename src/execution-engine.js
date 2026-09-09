export class ExecutionEngine {
  constructor() {
    this.orders = new Map();
    this.ordersByClientId = new Map();
    this.nextId = 1;
    this.nextEventId = 1;
    this.auditLog = [];
  }

  createOrder({ symbol, side, quantity, timeoutMs = 5000, clientOrderId = null, eventSequence = null }) {
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
      this.assertEventSequence(existing, eventSequence);
      this.record(existing.id, "DUPLICATE_ORDER", { clientOrderId }, eventSequence);
      return this.snapshot(existing);
    }

    if (eventSequence !== null && (!Number.isInteger(eventSequence) || eventSequence <= 0)) {
      throw new Error("invalid event sequence");
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
      lastEventSequence: null,
      processedFillIds: new Map()
    };
    this.orders.set(id, order);
    if (clientOrderId !== null) this.ordersByClientId.set(clientOrderId, id);
    this.record(id, "ORDER_CREATED", { symbol, side, quantity, timeoutMs, clientOrderId }, eventSequence);
    return this.snapshot(order);
  }

  onExchangeFill(id, quantity, fillId = null, eventSequence = null) {
    const order = this.require(id);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("invalid fill");
    }
    this.assertEventSequence(order, eventSequence);

    if (fillId !== null) {
      const previousQuantity = order.processedFillIds.get(fillId);
      if (previousQuantity !== undefined) {
        if (previousQuantity !== quantity) {
          throw new Error("conflicting fill id");
        }
        this.record(id, "DUPLICATE_FILL", { fillId, quantity }, eventSequence);
        return this.snapshot(order);
      }
      order.processedFillIds.set(fillId, quantity);
    }

    order.filledQty = Math.min(order.requestedQty, order.filledQty + quantity);
    order.status = order.filledQty === order.requestedQty ? "FILLED" : "PARTIAL";
    this.record(id, "EXCHANGE_FILL", { fillId, quantity, status: order.status }, eventSequence);
    return this.snapshot(order);
  }

  tick(id, elapsedMs, eventSequence = null) {
    const order = this.require(id);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new Error("invalid elapsed time");
    }
    this.assertEventSequence(order, eventSequence);

    order.elapsedMs += elapsedMs;

    if (order.filledQty === order.requestedQty) {
      order.status = "FILLED";
    } else if (order.elapsedMs >= order.timeoutMs) {
      order.status = "TIMED_OUT";
    }
    this.record(id, "TICK", { elapsedMs, status: order.status }, eventSequence);
    return this.snapshot(order);
  }

  crash(id, eventSequence = null) {
    const order = this.require(id);
    this.assertEventSequence(order, eventSequence);
    if (order.status !== "FILLED") order.status = "CRASHED";
    this.record(id, "CRASH", { status: order.status }, eventSequence);
    return this.snapshot(order);
  }

  recover(id, eventSequence = null) {
    const order = this.require(id);
    if (order.status !== "CRASHED" && order.status !== "TIMED_OUT") {
      return this.snapshot(order);
    }
    this.assertEventSequence(order, eventSequence);

    order.recovered = true;
    if (order.filledQty === order.requestedQty) {
      order.status = "FILLED";
    } else if (order.filledQty > 0) {
      order.status = "PARTIAL";
    } else {
      order.status = "PENDING";
    }
    this.record(id, "RECOVERY", { status: order.status, filledQty: order.filledQty }, eventSequence);
    return this.snapshot(order);
  }

  getAuditLog(id = null) {
    const events = id === null ? this.auditLog : this.auditLog.filter((event) => event.orderId === id);
    return structuredClone(events);
  }

  assertEventSequence(order, eventSequence) {
    if (eventSequence === null) return;
    if (!Number.isInteger(eventSequence) || eventSequence <= 0) {
      throw new Error("invalid event sequence");
    }
    if (order.lastEventSequence !== null && eventSequence <= order.lastEventSequence) {
      throw new Error("out-of-order event");
    }
  }

  record(orderId, type, payload, eventSequence = null) {
    const order = this.orders.get(orderId);
    this.assertEventSequence(order, eventSequence);
    if (order && eventSequence !== null) order.lastEventSequence = eventSequence;

    this.auditLog.push({
      eventId: String(this.nextEventId++),
      orderId,
      type,
      payload: structuredClone(payload),
      eventSequence,
      recordedAt: this.auditLog.length
    });
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
