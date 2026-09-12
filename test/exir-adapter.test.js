import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ExirAdapter } from "../src/exir-adapter.js";

const test = async (name, fn) => {
  try { await fn(); console.log("PASS:", name); }
  catch (error) { console.error("FAIL:", name); throw error; }
};

await test("HMAC signature matches Exir signing format", () => {
  const adapter = new ExirAdapter({ apiKey: "safe-key", apiSecret: "safe-secret", fetchImpl: async () => {} });
  const expected = crypto.createHmac("sha256", "safe-secret").update("GET/v2/user123456789").digest("hex");
  assert.equal(adapter.signature("GET", "/v2/user", 123456789), expected);
});

await test("private request sends required auth headers", async () => {
  let captured;
  const adapter = new ExirAdapter({
    apiKey: "safe-key", apiSecret: "safe-secret",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "user-1" }) };
    }
  });
  const result = await adapter.getUser();
  assert.deepEqual(result, { id: "user-1" });
  assert.equal(captured.url, "https://api.exir.io/v2/user");
  assert.equal(captured.options.method, "GET");
  assert.equal(captured.options.headers["api-key"], "safe-key");
  assert.ok(captured.options.headers["api-signature"]);
  assert.ok(captured.options.headers["api-expires"]);
  assert.equal(captured.options.body, undefined);
});

await test("balance uses the private balance endpoint", async () => {
  let url;
  const adapter = new ExirAdapter({ apiKey: "safe-key", apiSecret: "safe-secret", fetchImpl: async (requestUrl) => {
    url = requestUrl;
    return { ok: true, status: 200, text: async () => "[]" };
  }});
  assert.deepEqual(await adapter.getBalance(), []);
  assert.equal(url, "https://api.exir.io/v2/user/balance");
});

await test("order signs and sends the exact Exir order payload", async () => {
  let captured;
  const adapter = new ExirAdapter({
    apiKey: "safe-key", apiSecret: "safe-secret",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "order-1", status: "new" }) };
    }
  });
  const result = await adapter.order({ symbol: "BTC-USDT", side: "buy", quantity: 0.001, type: "market" });
  assert.deepEqual(result, { id: "order-1", status: "new" });
  assert.equal(captured.url, "https://api.exir.io/v2/order");
  assert.equal(captured.options.method, "POST");
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(body, { symbol: "btc-usdt", side: "buy", size: 0.001, type: "market" });
  const expires = captured.options.headers["api-expires"];
  const expected = crypto.createHmac("sha256", "safe-secret")
    .update(`POST/v2/order${expires}${captured.options.body}`)
    .digest("hex");
  assert.equal(captured.options.headers["api-signature"], expected);
});

await test("limit order requires a valid price", async () => {
  const adapter = new ExirAdapter({ apiKey: "safe-key", apiSecret: "safe-secret", fetchImpl: async () => {
    throw new Error("network call must not happen");
  }});
  await assert.rejects(() => adapter.order({ symbol: "BTC-USDT", side: "buy", quantity: 1, type: "limit" }), /price required/);
});

await test("non-2xx responses are normalized without exposing credentials", async () => {
  const adapter = new ExirAdapter({
    apiKey: "SECRET_KEY_SHOULD_NOT_APPEAR", apiSecret: "SECRET_SECRET_SHOULD_NOT_APPEAR",
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ message: "unauthorized" }) })
  });
  await assert.rejects(() => adapter.getUser(), (error) => {
    assert.equal(error.status, 401);
    assert.equal(String(error.message).includes("SECRET"), false);
    return true;
  });
});

await test("timeout aborts the request", async () => {
  const adapter = new ExirAdapter({ apiKey: "safe-key", apiSecret: "safe-secret", timeoutMs: 5,
    fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    })
  });
  await assert.rejects(() => adapter.getUser(), /timed out/);
});

await test("order status and cancel use authenticated private endpoints", async () => {
  const calls = [];
  const adapter = new ExirAdapter({ apiKey: "safe-key", apiSecret: "safe-secret", fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method });
    return { ok: true, status: 200, text: async () => "{}" };
  }});
  await adapter.orderStatus("order/1");
  await adapter.cancelOrder("order/1");
  assert.deepEqual(calls.map((call) => [call.url, call.method]), [
    ["https://api.exir.io/v2/order?order_id=order%2F1", "GET"],
    ["https://api.exir.io/v2/order?order_id=order%2F1", "DELETE"]
  ]);
});

await test("unsupported methods are blocked before the network call", async () => {
  const adapter = new ExirAdapter({ apiKey: "safe-key", apiSecret: "safe-secret", fetchImpl: async () => {
    throw new Error("network call must not happen");
  }});
  await assert.rejects(() => adapter.request("PUT", "/v2/order", {}), /method not supported/);
});

console.log("Exir Adapter Gate: ALL TESTS PASSED");
