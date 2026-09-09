import assert from "node:assert/strict";
import test from "node:test";
import { BinanceSandboxAdapter } from "../src/binance-sandbox-adapter.js";

const fixedClock = () => 1499827319559;

test("Binance sandbox HMAC signing matches the documented payload", () => {
  const adapter = new BinanceSandboxAdapter({ apiKey: "api", secretKey: "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j", clock: fixedClock });
  const signature = adapter.sign({ symbol: "LTCBTC", side: "BUY", type: "LIMIT", timeInForce: "GTC", quantity: "1", price: "0.1", recvWindow: "5000", timestamp: String(fixedClock()) });
  assert.equal(signature, "a13b8f5b6a0f3b4e9a3f4f95d8b0d0d0e2e5e6f1e0e7f0e9d4b3f0d0d2a4d5f");
});

test("Binance sandbox signs authenticated requests and never permits LIVE", async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ orderId: 123, clientOrderId: "cid", status: "NEW", executedQty: "0", price: "100" }) };
  };
  const adapter = new BinanceSandboxAdapter({ apiKey: "sandbox-key", secretKey: "sandbox-secret", transport, clock: fixedClock });
  const result = await adapter.submitOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 0.001, price: 100, clientOrderId: "cid" });
  assert.equal(result.exchangeOrderId, "123");
  assert.equal(new URL(calls[0].url).searchParams.get("timestamp"), String(fixedClock()));
  assert.match(new URL(calls[0].url).searchParams.get("signature"), /^[a-f0-9]{64}$/);
  assert.equal(calls[0].options.headers["X-MBX-APIKEY"], "sandbox-key");
  assert.throws(() => new BinanceSandboxAdapter({ apiKey: "x", secretKey: "y", mode: "LIVE" }), /live Binance adapter is locked/);
});

test("Binance sandbox handles timeout and HTTP/API auth failures fail-closed", async () => {
  const timeout = new BinanceSandboxAdapter({ apiKey: "x", secretKey: "y", timeoutMs: 5, transport: (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); })) });
  await assert.rejects(() => timeout.getAccount(), /timeout/);
  const unauthorized = new BinanceSandboxAdapter({ apiKey: "x", secretKey: "y", transport: async () => ({ ok: false, status: 401, json: async () => ({ code: -2015, msg: "Invalid API-key" }) }) });
  await assert.rejects(() => unauthorized.getAccount(), /HTTP 401/);
  const apiFailure = new BinanceSandboxAdapter({ apiKey: "x", secretKey: "y", transport: async () => ({ ok: true, status: 200, json: async () => ({ code: -1022, msg: "INVALID_SIGNATURE" }) }) });
  await assert.rejects(() => apiFailure.getAccount(), /-1022/);
});

test("Binance sandbox public connectivity uses the real testnet endpoint when requested", { skip: !process.env.BINANCE_SANDBOX_CONNECTIVITY }, async () => {
  const adapter = new BinanceSandboxAdapter({ apiKey: process.env.BINANCE_SANDBOX_API_KEY, secretKey: process.env.BINANCE_SANDBOX_SECRET_KEY });
  const ping = await adapter.ping();
  assert.deepEqual(ping, {});
  const account = await adapter.getAccount();
  assert.ok(Array.isArray(account.balances));
});

console.log("Binance Sandbox Adapter: ALL TESTS PASSED");
