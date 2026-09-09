import crypto from "node:crypto";

const TERMINAL = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED"]);

export class BinanceSandboxAdapter {
  constructor({ apiKey, secretKey, baseUrl = "https://testnet.binance.vision", transport = fetch, timeoutMs = 10000, recvWindow = 5000, mode = "SANDBOX", clock = () => Date.now() } = {}) {
    if (mode !== "SANDBOX") throw new Error("live Binance adapter is locked");
    if (typeof apiKey !== "string" || !apiKey) throw new Error("missing Binance sandbox api key");
    if (typeof secretKey !== "string" || !secretKey) throw new Error("missing Binance sandbox secret key");
    if (!/^https:\/\//.test(baseUrl)) throw new Error("invalid Binance sandbox base url");
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("invalid timeout");
    if (!Number.isInteger(recvWindow) || recvWindow <= 0 || recvWindow > 60000) throw new Error("invalid recvWindow");
    if (typeof transport !== "function" || typeof clock !== "function") throw new Error("invalid transport or clock");
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.recvWindow = recvWindow;
    this.mode = mode;
    this.clock = clock;
  }

  sign(params) {
    const payload = new URLSearchParams(params).toString();
    return crypto.createHmac("sha256", this.secretKey).update(payload).digest("hex");
  }

  async #request(path, { method = "GET", params = {}, signed = false } = {}) {
    const query = new URLSearchParams(params);
    if (signed) {
      query.set("timestamp", String(this.clock()));
      query.set("recvWindow", String(this.recvWindow));
      query.set("signature", this.sign(Object.fromEntries([...query.entries()].filter(([key]) => key !== "signature"))));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(`${this.baseUrl}${path}?${query.toString()}`, {
        method,
        headers: { "X-MBX-APIKEY": this.apiKey, "content-type": "application/x-www-form-urlencoded" },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Binance sandbox HTTP ${response.status}: ${payload.msg || "request failed"}`);
      if (payload?.code && payload.code < 0) throw new Error(`Binance sandbox API ${payload.code}: ${payload.msg || "request failed"}`);
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Binance sandbox timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async ping() {
    return this.#request("/api/v3/ping");
  }

  async getServerTime() {
    return this.#request("/api/v3/time");
  }

  async getAccount() {
    return this.#request("/api/v3/account", { signed: true });
  }

  async submitOrder({ symbol, side, quantity, price, clientOrderId }) {
    if (typeof symbol !== "string" || !symbol) throw new Error("invalid symbol");
    if (!["BUY", "SELL"].includes(side)) throw new Error("invalid order side");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid order quantity");
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid order price");
    if (typeof clientOrderId !== "string" || !clientOrderId) throw new Error("invalid client order id");
    const result = await this.#request("/api/v3/order", { method: "POST", signed: true, params: { symbol, side, type: "LIMIT", timeInForce: "GTC", quantity: String(quantity), price: String(price), newClientOrderId: clientOrderId } });
    if (!Number.isInteger(result.orderId)) throw new Error("Binance sandbox missing orderId");
    return { exchangeOrderId: String(result.orderId), clientOrderId: result.clientOrderId || clientOrderId, status: result.status, filledQuantity: Number(result.executedQty || 0), averageFillPrice: Number(result.price || price), mode: this.mode, raw: result };
  }

  async getOrder(exchangeOrderId, symbol) {
    if (!symbol || !exchangeOrderId) throw new Error("symbol and exchange order id are required");
    return this.#request("/api/v3/order", { signed: true, params: { symbol, orderId: String(exchangeOrderId) } });
  }

  async reconcile(exchangeOrderId, symbol) {
    const order = await this.getOrder(exchangeOrderId, symbol);
    return { ...order, terminal: TERMINAL.has(order.status) };
  }

  async cancelOrder(exchangeOrderId, symbol) {
    if (!symbol || !exchangeOrderId) throw new Error("symbol and exchange order id are required");
    return this.#request("/api/v3/order", { method: "DELETE", signed: true, params: { symbol, orderId: String(exchangeOrderId) } });
  }
}
