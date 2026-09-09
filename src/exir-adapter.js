import crypto from "node:crypto";

const TERMINAL = new Set(["filled", "canceled", "rejected", "expired"]);

export class ExirAdapter {
  constructor({ apiKey, secretKey, baseUrl = "https://api.exir.io", transport = fetch, timeoutMs = 10000, clock = () => Date.now() } = {}) {
    if (typeof apiKey !== "string" || !apiKey) throw new Error("missing Exir api key");
    if (typeof secretKey !== "string" || !secretKey) throw new Error("missing Exir api secret");
    if (!/^https:\/\//.test(baseUrl)) throw new Error("invalid Exir base url");
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("invalid timeout");
    if (typeof transport !== "function" || typeof clock !== "function") throw new Error("invalid transport or clock");
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.clock = clock;
    this.mode = "LIVE";
  }

  sign(method, path, expires, body = "") {
    return crypto.createHmac("sha256", this.secretKey).update(`${method}${path}${expires}${body}`).digest("hex");
  }

  async #request(path, { method = "GET", body = null } = {}) {
    const expires = Math.floor(this.clock() / 1000) + 60;
    const bodyText = body === null ? "" : JSON.stringify(body);
    const signature = this.sign(method, path, expires, bodyText);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "api-key": this.apiKey,
          "api-signature": signature,
          "api-expires": String(expires),
          "content-type": "application/json"
        },
        ...(body === null ? {} : { body: bodyText }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Exir HTTP ${response.status}: ${payload?.message || payload?.error || "request failed"}`);
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Exir timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getUser() {
    return this.#request("/v2/user");
  }

  async getBalance() {
    return this.#request("/v2/user/balance");
  }

  async submitOrder({ symbol, side, quantity, price, clientOrderId }) {
    if (typeof symbol !== "string" || !symbol) throw new Error("invalid symbol");
    if (!["BUY", "SELL"].includes(side)) throw new Error("invalid order side");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid order quantity");
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid order price");
    if (typeof clientOrderId !== "string" || !clientOrderId) throw new Error("invalid client order id");
    const result = await this.#request("/v2/order", {
      method: "POST",
      body: { symbol: symbol.toLowerCase(), side: side.toLowerCase(), size: quantity, type: "limit", price }
    });
    if (!result?.id) throw new Error("Exir missing order id");
    return {
      exchangeOrderId: String(result.id),
      clientOrderId,
      status: String(result.status || "new").toUpperCase(),
      filledQuantity: Number(result.filled || 0),
      averageFillPrice: Number(result.average || result.price || price),
      mode: this.mode,
      raw: result
    };
  }

  async getOrder(exchangeOrderId) {
    if (!exchangeOrderId) throw new Error("exchange order id is required");
    return this.#request(`/v2/order?order_id=${encodeURIComponent(String(exchangeOrderId))}`);
  }

  async reconcile(exchangeOrderId) {
    const order = await this.getOrder(exchangeOrderId);
    return { ...order, terminal: TERMINAL.has(String(order.status || "").toLowerCase()) };
  }

  async cancelOrder(exchangeOrderId) {
    if (!exchangeOrderId) throw new Error("exchange order id is required");
    return this.#request(`/v2/order?order_id=${encodeURIComponent(String(exchangeOrderId))}`, { method: "DELETE" });
  }
}
