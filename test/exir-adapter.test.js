import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ExirAdapter } from "../src/exir-adapter.js";

const fixedClock = () => 1_700_000_000_000;

function response(payload, ok = true, status = 200) {
  return { ok, status, async json() { return payload; } };
}

test("Exir HMAC signature matches the documented signing format", () => {
  const adapter = new ExirAdapter({ apiKey: "key", secretKey: "secret", clock: fixedClock, transport: async () => response({}) });
  const expires = 1_700_000_060;
  const expected = crypto.createHmac("sha256", "secret").update(`GET/v2/user/balance${expires}`).digest("hex");
  assert.equal(adapter.sign("GET", "/v2/user/balance", expires), expected);
});

test("Exir read-only account access signs and sends authenticated requests", async () => {
  let seen;
  const adapter = new ExirAdapter({
    apiKey: "test-key",
    secretKey: "test-secret",
    clock: fixedClock,
    transport: async (url, options) => {
      seen = { url, options };
      return response({ usdt: { available: "100" } });
    }
  });
  const result = await adapter.getBalance();
  assert.deepEqual(result, { usdt: { available: "100" } });
  assert.equal(seen.url, "https://api.exir.io/v2/user/balance");
  assert.equal(seen.options.method, "GET");
  assert.equal(seen.options.headers["api-key"], "test-key");
  assert.equal(seen.options.headers["api-expires"], "1700000060");
  assert.match(seen.options.headers["api-signature"], /^[a-f0-9]{64}$/);
});

test("Exir order adapter never treats an HTTP/API failure as success", async () => {
  const adapter = new ExirAdapter({
    apiKey: "key",
    secretKey: "secret",
    clock: fixedClock,
    transport: async () => response({ message: "unauthorized" }, false, 401)
  });
  await assert.rejects(() => adapter.getBalance(), /Exir HTTP 401/);
});

test("Exir order mapping preserves exchange order id and fill state", async () => {
  let seen;
  const adapter = new ExirAdapter({
    apiKey: "key",
    secretKey: "secret",
    clock: fixedClock,
    transport: async (url, options) => {
      seen = { url, options };
      return response({ id: "order-123", status: "filled", filled: 0.01, average: 3450, price: 3450 });
    }
  });
  const result = await adapter.submitOrder({ symbol: "ETH-USDT", side: "BUY", quantity: 0.01, price: 3450, clientOrderId: "copy-1" });
  assert.equal(result.exchangeOrderId, "order-123");
  assert.equal(result.status, "FILLED");
  assert.equal(result.filledQuantity, 0.01);
  assert.equal(result.averageFillPrice, 3450);
  assert.equal(JSON.parse(seen.options.body).symbol, "eth-usdt");
});

test("Exir timeout fails closed", async () => {
  const adapter = new ExirAdapter({
    apiKey: "key",
    secretKey: "secret",
    timeoutMs: 5,
    transport: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); }))
  });
  await assert.rejects(() => adapter.getBalance(), /Exir timeout/);
});

test("Exir credentials are required", () => {
  assert.throws(() => new ExirAdapter({ apiKey: "", secretKey: "secret" }), /missing Exir api key/);
  assert.throws(() => new ExirAdapter({ apiKey: "key", secretKey: "" }), /missing Exir api secret/);
});
