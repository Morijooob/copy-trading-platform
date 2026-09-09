export class MultiAccountCopyExecution {
  constructor({ accounts = [], exchangeAdapter = null } = {}) {
    this.accounts = new Map();
    this.audit = [];
    this.exchangeAdapter = exchangeAdapter;
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
          let exchangeOrder = null;
          if (this.exchangeAdapter) {
            try {
              exchangeOrder = this.exchangeAdapter.submitOrder({ accountId: account.accountId, symbol, side, quantity, price, clientOrderId });
              if (!exchangeOrder || typeof exchangeOrder.exchangeOrderId !== "string" || !exchangeOrder.exchangeOrderId) throw new Error("exchange adapter returned invalid order");
              account.executionEngine.reconcileExchangeState(order.id, { found: true, exchangeOrderId: exchangeOrder.exchangeOrderId, filledQty: Number(exchangeOrder.filledQty ?? 0) }, eventSequence === null ? null : eventSequence + 1);
              if (Number(exchangeOrder.filledQty ?? 0) > 0) account.riskEngine.releaseExposure(decision.notional * (Number(exchangeOrder.filledQty) / quantity));
            } catch (exchangeError) {
              account.executionEngine.markSubmissionUnknown(order.id, String(exchangeError.message || exchangeError), eventSequence === null ? null : eventSequence + 1);
              results.push({ accountId: account.accountId, status: "EXCHANGE_UNKNOWN", reason: String(exchangeError.message || exchangeError), order: account.executionEngine.getOrderById(order.id), exchangeOrder: null });
              continue;
            }
          }
          results.push({ accountId: account.accountId, status: "SUBMITTED", reason: null, order: account.executionEngine.getOrderById(order.id), exchangeOrder });
        } catch (error) {
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

  getAuditLog() { return structuredClone(this.audit); }
  exportState() { return { audit: this.getAuditLog(), accounts: [...this.accounts.values()].map((a) => ({ accountId: a.accountId, enabled: a.enabled })) }; }
  requireAccount(accountId) { const account = this.accounts.get(accountId); if (!account) throw new Error(`unknown account: ${accountId}`); return account; }
}
