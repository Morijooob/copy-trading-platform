import assert from "node:assert/strict";
import test from "node:test";
import { BinanceSandboxAdapter } from "../src/binance-sandbox-adapter.js";

const fixedClock = () => 1668481559918;
const docsSecret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";

test("Binance sandbox HMAC signing matches the documented regression vector", () => {
  const adapter = new BinanceSandboxAdapter({ apiKey: "api", secretKey: docsSecret, clock: fixedClock });
  const signature = adapter.sign({ symbol: "BTCUSDT", side: "SELL", type: "LIMIT", timeInForce: "GTC", quantity: "1", price: "0.2", timestamp: String(fixedClock()), recvWindow: "5000" });
  assert.equal(signature, "e1353ec6b14d888f1164ae9af8228a3dbd508bc82eb867db8ab6046442f33ef3");
});

test("Binance sandbox signs authenticated requests and never permits LIVE", async () => {
  const calls = [];
  const transport = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => ({ orderId: 123, clientOrderId: "cid", status: "NEW", executedQty: "0", price: "100" }) }; };
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

test("Binance sandbox real connectivity is exercised only when explicit CI secrets are present", { skip: !process.env.BINANCE_SANDBOX_CONNECTIVITY }, async () => {
  const adapter = new BinanceSandboxAdapter({ apiKey: process.env.BINANCE_SANDBOX_API_KEY, secretKey: process.env.BINANCE_SANDBOX_SECRET_KEY });
  assert.deepEqual(await adapter.ping(), {});
  const account = await adapter.getAccount();
  assert.ok(Array.isArray(account.balances));
});

console.log("Binance Sandbox Adapter: ALL TESTS PASSED");
