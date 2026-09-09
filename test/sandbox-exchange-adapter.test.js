import assert from "node:assert/strict";
import test from "node:test";
import { SandboxExchangeAdapter } from "../src/sandbox-exchange-adapter.js";

test("sandbox adapter submits orders and never permits live mode", async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ exchangeOrderId: "sbx-1", status: "OPEN" }) };
  };
  const adapter = new SandboxExchangeAdapter({ baseUrl: "https://sandbox.example", apiKey: "secret", transport });
  const result = await adapter.submitOrder({ accountId: "acct-1", symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100, clientOrderId: "client-1" });
  assert.equal(result.exchangeOrderId, "sbx-1");
  assert.equal(result.mode, "SANDBOX");
  assert.equal(calls[0].options.headers.authorization, "Bearer secret");
  assert.equal(JSON.parse(calls[0].options.body).clientOrderId, "client-1");
  assert.throws(() => new SandboxExchangeAdapter({ baseUrl: "https://example.com", mode: "LIVE" }), /live exchange adapter is locked/);
});

test("sandbox adapter reconciles and cancels through isolated endpoints", async () => {
  const paths = [];
  const transport = async (url, options) => {
    paths.push(`${options.method} ${url}`);
    if (url.endsWith("/cancel")) return { ok: true, status: 200, json: async () => ({ status: "CANCELED" }) };
    return { ok: true, status: 200, json: async () => ({ exchangeOrderId: "sbx-2", status: "FILLED", filledQuantity: 2 }) };
  };
  const adapter = new SandboxExchangeAdapter({ baseUrl: "https://sandbox.example", transport });
  const reconciled = await adapter.reconcile("sbx-2");
  assert.equal(reconciled.terminal, true);
  const canceled = await adapter.cancelOrder("sbx-2");
  assert.equal(canceled.status, "CANCELED");
  assert.deepEqual(paths, ["GET https://sandbox.example/orders/sbx-2", "POST https://sandbox.example/orders/sbx-2/cancel"]);
});

test("sandbox adapter fails closed on HTTP errors, timeouts, and missing exchange IDs", async () => {
  const httpError = new SandboxExchangeAdapter({ baseUrl: "https://sandbox.example", transport: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  await assert.rejects(() => httpError.getOrder("x"), /http 503/);

  const missingId = new SandboxExchangeAdapter({ baseUrl: "https://sandbox.example", transport: async () => ({ ok: true, status: 200, json: async () => ({ status: "OPEN" }) }) });
  await assert.rejects(() => missingId.submitOrder({ side: "BUY", quantity: 1, price: 1, clientOrderId: "x" }), /missing exchangeOrderId/);

  const timeout = new SandboxExchangeAdapter({ baseUrl: "https://sandbox.example", timeoutMs: 5, transport: (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); });
  }) });
  await assert.rejects(() => timeout.getOrder("x"), /timeout/);
});

console.log("Sandbox Exchange Adapter: ALL TESTS PASSED");
