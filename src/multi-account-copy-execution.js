export class MultiAccountCopyExecution {
  constructor({ accounts = [], exchangeAdapter = null } = {}) {
    this.accounts = new Map();
    this.audit = [];
    this.exchangeAdapter = exchangeAdapter;
    this.reservations = new Map();
    for (const account of accounts) this.addAccount(account);
  }

  addAccount({ accountId, riskEngine, executionEngine, enabled = true } = {}) {
    if (!accountId || typeof accountId !== "string") throw new Error("invalid account id");
    if (this.accounts.has(accountId)) throw new Error("duplicate account id");
    if (!riskEngine || typeof riskEngine.approve !== "function") throw new Error("invalid account risk engine");
    if (!executionEngine || typeof executionEngine.createOrder !== "function") throw new Error("invalid account execution engine");
    this.accounts.set(accountId, { accountId, riskEngine, executionEngine, enabled: Boolean(enabled) });
    this.audit.push({ type: "ACCOUNT_ADDED", accountId, enabled: Boolean(enabled) });
    return this.getAccount(accountId);
  }

  setAccountEnabled(accountId, enabled) {
    const account = this.requireAccount(accountId);
    account.enabled = Boolean(enabled);
    this.audit.push({ type: account.enabled ? "ACCOUNT_ENABLED" : "ACCOUNT_DISABLED", accountId });
    return account.enabled;
  }

  getAccount(accountId) {
    const account = this.accounts.get(accountId);
    return account ? { accountId: account.accountId, enabled: account.enabled } : null;
  }

  executeCopy({ signalId, symbol, side, quantity, price, timeoutMs = 5000, eventSequence = null } = {}) {
    if (!signalId || typeof signalId !== "string") throw new Error("invalid signal id");
    if (!symbol || (side !== "BUY" && side !== "SELL") || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) throw new Error("invalid copy signal");
    const results = [];
    for (const account of this.accounts.values()) {
      if (!account.enabled) {
        results.push({ accountId: account.accountId, status: "SKIPPED", reason: "ACCOUNT_DISABLED", order: null, exchangeOrder: null });
        continue;
      }
      const clientOrderId = `copy:${signalId}:${account.accountId}`;
      const existing = account.executionEngine.getOrderByClientId?.(clientOrderId);
      if (existing) {
        if (existing.symbol !== symbol || existing.side !== side || existing.requestedQty !== quantity || existing.timeoutMs !== timeoutMs) throw new Error("conflicting copy idempotency key");
        results.push({ accountId: account.accountId, status: "IDEMPOTENT", reason: "ALREADY_SUBMITTED", order: existing, exchangeOrder: null });
        continue;
      }
      try {
        const decision = account.riskEngine.approve({ side, quantity, price });
        if (!decision.approved) {
          results.push({ accountId: account.accountId, status: "RISK_REJECTED", reason: decision.failedChecks.join(",") || "RISK_REJECTED", order: null, exchangeOrder: null });
          continue;
        }
        account.riskEngine.reserveExposure(decision.notional);
        try {
          const order = account.executionEngine.createOrder({ symbol, side, quantity, timeoutMs, clientOrderId, eventSequence });
          this.reservations.set(`${account.accountId}:${order.id}`, { accountId: account.accountId, orderId: order.id, quantity, price, remainingQuantity: quantity, remainingNotional: decision.notional, processedFills: new Map() });
          let exchangeOrder = null;
          if (this.exchangeAdapter) {
            try {
              exchangeOrder = this.exchangeAdapter.submitOrder({ accountId: account.accountId, symbol, side, quantity, price, clientOrderId });
              if (!exchangeOrder || typeof exchangeOrder.exchangeOrderId !== "string" || !exchangeOrder.exchangeOrderId) throw new Error("exchange adapter returned invalid order");
              const filledQty = Number(exchangeOrder.filledQuantity ?? exchangeOrder.filledQty ?? 0);
              if (!Number.isFinite(filledQty) || filledQty < 0 || filledQty > quantity) throw new Error("exchange adapter returned invalid filled quantity");
              account.executionEngine.reconcileExchangeState(order.id, { found: true, exchangeOrderId: exchangeOrder.exchangeOrderId, filledQty }, eventSequence === null ? null : eventSequence + 1);
              if (filledQty > 0) this.onExchangeFill(account.accountId, order.id, filledQty, Number(exchangeOrder.averageFillPrice ?? price), eventSequence === null ? null : eventSequence + 2, { skipExecutionUpdate: true, fillId: `exchange:${exchangeOrder.exchangeOrderId}:initial` });
            } catch (exchangeError) {
              account.executionEngine.markSubmissionUnknown(order.id, String(exchangeError.message || exchangeError), eventSequence === null ? null : eventSequence + 1);
              results.push({ accountId: account.accountId, status: "EXCHANGE_UNKNOWN", reason: String(exchangeError.message || exchangeError), order: account.executionEngine.getOrderById(order.id), exchangeOrder: null });
              continue;
            }
          }
          results.push({ accountId: account.accountId, status: "SUBMITTED", reason: null, order: account.executionEngine.getOrderById(order.id), exchangeOrder });
        } catch (error) {
          this.reservations.delete(`${account.accountId}:${order.id}`);
          account.riskEngine.releaseExposure(decision.notional);
          results.push({ accountId: account.accountId, status: "FAILED", reason: String(error.message), order: null, exchangeOrder: null });
        }
      } catch (error) {
        results.push({ accountId: account.accountId, status: "FAILED", reason: String(error.message), order: null, exchangeOrder: null });
      }
    }
    const summary = {
      signalId,
      results,
      submitted: results.filter((r) => r.status === "SUBMITTED").length,
      idempotent: results.filter((r) => r.status === "IDEMPOTENT").length,
      rejected: results.filter((r) => r.status === "RISK_REJECTED").length,
      failed: results.filter((r) => r.status === "FAILED").length,
      exchangeUnknown: results.filter((r) => r.status === "EXCHANGE_UNKNOWN").length,
      skipped: results.filter((r) => r.status === "SKIPPED").length
    };
    this.audit.push({ type: "COPY_EXECUTED", signalId, summary: { submitted: summary.submitted, idempotent: summary.idempotent, rejected: summary.rejected, failed: summary.failed, exchangeUnknown: summary.exchangeUnknown, skipped: summary.skipped } });
    return summary;
  }

  onExchangeFill(accountId, orderId, quantity, price, eventSequence = null, { skipExecutionUpdate = false, fillId = null } = {}) {
    const account = this.requireAccount(accountId);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid fill quantity");
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid fill price");
    const key = `${accountId}:${orderId}`;
    const reservation = this.reservations.get(key);
    if (!reservation) throw new Error("missing copy exposure reservation");
    const effectiveFillId = fillId ?? `copy-fill:${accountId}:${orderId}:${reservation.quantity - reservation.remainingQuantity + quantity}`;
    const previous = reservation.processedFills.get(effectiveFillId);
    if (previous !== undefined) {
      if (previous.quantity !== quantity || previous.price !== price) throw new Error("conflicting copy fill id");
      const existingOrder = account.executionEngine.getOrderById(orderId);
      this.audit.push({ type: "DUPLICATE_COPY_FILL", accountId, orderId, fillId: effectiveFillId, quantity, price });
      return { ...existingOrder, exposure: account.riskEngine.exposure, reservedExposure: account.riskEngine.reservedExposure, duplicate: true };
    }
    if (quantity > reservation.remainingQuantity) throw new Error("fill exceeds remaining copy quantity");
    const notional = quantity * price;
    if (notional > reservation.remainingNotional + 1e-9) throw new Error("filled exposure exceeds reservation");
    if (!skipExecutionUpdate) account.executionEngine.onExchangeFill(orderId, quantity, effectiveFillId, eventSequence);
    account.riskEngine.commitReservedExposure(notional);
    reservation.processedFills.set(effectiveFillId, { quantity, price });
    reservation.remainingQuantity -= quantity;
    reservation.remainingNotional -= notional;
    if (reservation.remainingQuantity <= 1e-12) {
      if (reservation.remainingNotional > 1e-9) account.riskEngine.releaseExposure(reservation.remainingNotional);
      this.reservations.delete(key);
    }
    this.audit.push({ type: "COPY_FILL_COMMITTED", accountId, orderId, fillId: effectiveFillId, quantity, price, notional, remainingQuantity: Math.max(0, reservation.remainingQuantity), remainingNotional: Math.max(0, reservation.remainingNotional) });
    return { ...account.executionEngine.getOrderById(orderId), exposure: account.riskEngine.exposure, reservedExposure: account.riskEngine.reservedExposure };
  }

  getAuditLog() { return structuredClone(this.audit); }
  exportState() { return { audit: this.getAuditLog(), accounts: [...this.accounts.values()].map((a) => ({ accountId: a.accountId, enabled: a.enabled })) }; }
  requireAccount(accountId) { const account = this.accounts.get(accountId); if (!account) throw new Error(`unknown account: ${accountId}`); return account; }
}
