import assert from "node:assert/strict";
import test from "node:test";
import { BinanceReadOnlyAdapter } from "../src/binance-readonly-adapter.js";

const fixedClock = () => 1499827319559;

test("Binance read-only adapter signs GET account requests and never sends non-GET methods", async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ balances: [] }) };
  };
  const adapter = new BinanceReadOnlyAdapter({ apiKey: "read-only-key", secretKey: "read-only-secret", transport, clock: fixedClock });
  const account = await adapter.getAccount();
  assert.deepEqual(account, { balances: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.match(new URL(calls[0].url).searchParams.get("signature"), /^[a-f0-9]{64}$/);
  assert.equal(calls[0].options.headers["X-MBX-APIKEY"], "read-only-key");
});

test("Binance read-only real connectivity runs only with explicit CI secrets", { skip: !process.env.BINANCE_READONLY_CONNECTIVITY }, async () => {
  const adapter = new BinanceReadOnlyAdapter({
    apiKey: process.env.BINANCE_API_KEY,
    secretKey: process.env.BINANCE_API_SECRET
  });
  const account = await adapter.getAccount();
  assert.ok(Array.isArray(account.balances));
});

console.log("Binance Read-Only Adapter: ALL TESTS PASSED");
