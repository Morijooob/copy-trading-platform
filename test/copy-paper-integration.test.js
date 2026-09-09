import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionEngine } from "../src/execution-engine.js";
import { MultiAccountCopyExecution } from "../src/multi-account-copy-execution.js";
import { PaperExchange } from "../src/paper-exchange.js";

function riskEngine() {
  return {
    exposure: 0,
    approve({ quantity, price }) { return { approved: true, notional: quantity * price, failedChecks: [] }; },
    reserveExposure(notional) { this.exposure += notional; },
    releaseExposure(notional) { this.exposure -= notional; }
  };
}

test("signal -> risk -> copy -> paper exchange -> fill -> reconciliation", () => {
  const exchange = new PaperExchange({ latencyMs: 0 });
  const risk = riskEngine();
  const execution = new ExecutionEngine();
  const copy = new MultiAccountCopyExecution({
    exchangeAdapter: exchange,
    accounts: [{ accountId: "acct-1", riskEngine: risk, executionEngine: execution }]
  });

  const first = copy.executeCopy({ signalId: "sig-1", symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, eventSequence: 1 });
  assert.equal(first.submitted, 1);
  assert.equal(first.results[0].exchangeOrder.exchangeOrderId, "paper-1");
  assert.equal(first.results[0].order.status, "PENDING");
  assert.equal(risk.exposure, 200);

  const fill = exchange.fillOrder("paper-1", 1, 100);
  const reconciled = execution.reconcileExchangeState(first.results[0].order.id, { found: true, exchangeOrderId: fill.exchangeOrderId, filledQty: fill.filledQty }, 3);
  assert.equal(reconciled.status, "PARTIAL");
  assert.equal(reconciled.filledQty, 1);

  const full = exchange.fillOrder("paper-1", 1, 101);
  const final = execution.reconcileExchangeState(first.results[0].order.id, { found: true, exchangeOrderId: full.exchangeOrderId, filledQty: full.filledQty }, 4);
  assert.equal(final.status, "FILLED");
  assert.equal(final.filledQty, 2);

  const replay = copy.executeCopy({ signalId: "sig-1", symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, eventSequence: 5 });
  assert.equal(replay.idempotent, 1);
  assert.equal(exchange.snapshot().orders.length, 1);
});

test("exchange submission failure fails closed without releasing reserved exposure", () => {
  const risk = riskEngine();
  const execution = new ExecutionEngine();
  const failingExchange = { submitOrder() { throw new Error("paper exchange timeout"); } };
  const copy = new MultiAccountCopyExecution({
    exchangeAdapter: failingExchange,
    accounts: [{ accountId: "acct-1", riskEngine: risk, executionEngine: execution }]
  });

  const result = copy.executeCopy({ signalId: "sig-timeout", symbol: "ETHUSDT", side: "BUY", quantity: 1, price: 200 });
  assert.equal(result.exchangeUnknown, 1);
  assert.equal(risk.exposure, 200);
  assert.equal(result.results[0].order.status, "UNKNOWN");
  assert.equal(result.results[0].order.failureState, "NETWORK_UNKNOWN");
});
