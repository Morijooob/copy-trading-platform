import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionEngine } from "../src/execution-engine.js";
import { MultiAccountCopyExecution } from "../src/multi-account-copy-execution.js";
import { PaperExchange } from "../src/paper-exchange.js";

function riskEngine() {
  return {
    exposure: 0,
    reservedExposure: 0,
    approve({ quantity, price }) { return { approved: true, notional: quantity * price, failedChecks: [] }; },
    reserveExposure(notional) { this.reservedExposure += notional; },
    releaseExposure(notional) { if (notional > this.reservedExposure) throw new Error("release exceeds reservation"); this.reservedExposure -= notional; },
    commitReservedExposure(notional) { if (notional > this.reservedExposure + 1e-9) throw new Error("commit exceeds reservation"); this.reservedExposure -= notional; this.exposure += notional; return { exposure: this.exposure, reservedExposure: this.reservedExposure }; }
  };
}

test("signal -> risk -> copy -> paper exchange -> partial/full fills -> reconciliation -> replay", () => {
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
  assert.equal(risk.exposure, 0);
  assert.equal(risk.reservedExposure, 200);

  const fill = exchange.fillOrder("copy:sig-1:acct-1", 1, 100);
  const reconciled = copy.onExchangeFill("acct-1", first.results[0].order.id, fill.filledQuantity, 100, 3);
  assert.equal(reconciled.filledQty, 1);
  assert.equal(reconciled.status, "PARTIAL");
  assert.equal(risk.exposure, 100);
  assert.equal(risk.reservedExposure, 100);

  const duplicate = copy.onExchangeFill("acct-1", first.results[0].order.id, 0.5, 100, 4);
  assert.equal(duplicate.filledQty, 1.5);
  assert.equal(risk.exposure, 150);
  assert.equal(risk.reservedExposure, 50);

  const full = exchange.fillOrder("copy:sig-1:acct-1", 0.5, 101);
  const final = copy.onExchangeFill("acct-1", first.results[0].order.id, 0.5, 101, 5);
  assert.equal(final.filledQty, 2);
  assert.equal(final.status, "FILLED");
  assert.equal(risk.exposure, 200.5);
  assert.equal(risk.reservedExposure, 0);
  assert.equal(full.status, "FILLED");

  assert.throws(() => copy.onExchangeFill("acct-1", first.results[0].order.id, 0.1, 101, 6), /missing copy exposure reservation/);

  const replay = copy.executeCopy({ signalId: "sig-1", symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, eventSequence: 7 });
  assert.equal(replay.idempotent, 1);
  assert.equal(exchange.orders.size, 1);
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
  assert.equal(risk.exposure, 0);
  assert.equal(risk.reservedExposure, 200);
  assert.equal(result.results[0].order.status, "UNKNOWN");
  assert.equal(result.results[0].order.failureState, "NETWORK_UNKNOWN");
});
