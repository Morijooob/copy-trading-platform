import crypto from "node:crypto";

export class BinanceReadOnlyAdapter {
  constructor({ apiKey, secretKey, baseUrl = "https://api.binance.com", transport = fetch, timeoutMs = 10000, recvWindow = 5000, clock = () => Date.now() } = {}) {
    if (typeof apiKey !== "string" || !apiKey) throw new Error("missing Binance api key");
    if (typeof secretKey !== "string" || !secretKey) throw new Error("missing Binance secret key");
    if (!/^https:\/\//.test(baseUrl)) throw new Error("invalid Binance base url");
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("invalid timeout");
    if (!Number.isInteger(recvWindow) || recvWindow <= 0 || recvWindow > 60000) throw new Error("invalid recvWindow");
    if (typeof transport !== "function" || typeof clock !== "function") throw new Error("invalid transport or clock");
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.recvWindow = recvWindow;
    this.clock = clock;
  }

  sign(params) {
    return crypto.createHmac("sha256", this.secretKey).update(new URLSearchParams(params).toString()).digest("hex");
  }

  async #request(path, params = {}) {
    const query = new URLSearchParams(params);
    query.set("timestamp", String(this.clock()));
    query.set("recvWindow", String(this.recvWindow));
    query.set("signature", this.sign(Object.fromEntries([...query.entries()].filter(([key]) => key !== "signature"))));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(`${this.baseUrl}${path}?${query.toString()}`, {
        method: "GET",
        headers: { "X-MBX-APIKEY": this.apiKey },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Binance read-only HTTP ${response.status}: ${payload.msg || "request failed"}`);
      if (payload?.code && payload.code < 0) throw new Error(`Binance read-only API ${payload.code}: ${payload.msg || "request failed"}`);
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Binance read-only timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getAccount() {
    return this.#request("/api/v3/account");
  }
}
