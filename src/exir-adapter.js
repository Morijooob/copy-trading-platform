import crypto from "node:crypto";

const DEFAULT_BASE_URL = "https://api.exir.io";

export class ExirAdapter {
  constructor({ apiKey, apiSecret, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
    if (!apiKey || !apiSecret) throw new Error("Exir API credentials are required");
    if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
    this.apiKey = String(apiKey);
    this.apiSecret = String(apiSecret);
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  signature(method, path, expires, body = "") {
    const payload = `${method.toUpperCase()}${path}${expires}${body}`;
    return crypto.createHmac("sha256", this.apiSecret).update(payload).digest("hex");
  }

  async request(method, path, body) {
    const normalizedMethod = method.toUpperCase();
    if (normalizedMethod !== "GET") throw new Error("Exir adapter is read-only");
    if (!path.startsWith("/v2/")) throw new Error("Exir path must start with /v2/");
    const expires = Math.floor(Date.now() / 1000) + 30;
    const bodyText = body === undefined ? "" : JSON.stringify(body);
    const headers = {
      "api-key": this.apiKey,
      "api-signature": this.signature(normalizedMethod, path, expires, bodyText),
      "api-expires": String(expires),
      "content-type": "application/json"
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: normalizedMethod,
        headers,
        body: body === undefined ? undefined : bodyText,
        signal: controller.signal
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) {
        const error = new Error(`Exir API request failed with HTTP ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Exir API request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  getUser() {
    return this.request("GET", "/v2/user");
  }

  getBalance() {
    return this.request("GET", "/v2/user/balance");
  }

  // Deliberately absent: order placement is not enabled by this read-only adapter.
}
