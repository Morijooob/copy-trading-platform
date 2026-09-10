import assert from "node:assert/strict";
import { ExirAdapter } from "../src/exir-adapter.js";

const apiKey = process.env.EXIR_API_KEY;
const apiSecret = process.env.EXIR_API_SECRET;

if (!apiKey || !apiSecret) {
  throw new Error("EXIR_API_KEY and EXIR_API_SECRET GitHub Actions secrets are required");
}

const adapter = new ExirAdapter({ apiKey, apiSecret, timeoutMs: 10000 });

try {
  const user = await adapter.getUser();
  assert.ok(user, "Exir /v2/user returned an empty response");

  const balance = await adapter.getBalance();
  assert.ok(balance !== undefined && balance !== null, "Exir balance returned an empty response");

  console.log("PASS: Exir private read-only connection verified");
} catch (error) {
  const status = error?.status ? ` HTTP ${error.status}` : "";
  console.error(`FAIL: Exir read-only connection${status}: ${error?.message || "unknown error"}`);
  process.exitCode = 1;
}
