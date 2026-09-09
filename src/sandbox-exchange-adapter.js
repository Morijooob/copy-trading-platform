const TERMINAL_STATUSES = new Set(["FILLED", "CANCELED", "REJECTED"]);

export class SandboxExchangeAdapter {
  constructor({ baseUrl, apiKey = "", transport = fetch, timeoutMs = 5000, mode = "SANDBOX" } = {}) {
    if (mode !== "SANDBOX") throw new Error("live exchange adapter is locked");
    if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) throw new Error("invalid sandbox base url");
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("invalid timeout");
    if (typeof transport !== "function") throw new Error("invalid transport");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.mode = mode;
  }

  async #request(path, { method = "GET", body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`sandbox exchange http ${response.status}`);
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("sandbox exchange timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async submitOrder(request) {
    if (!request || !["BUY", "SELL"].includes(request.side)) throw new Error("invalid order side");
    if (!Number.isFinite(request.quantity) || request.quantity <= 0) throw new Error("invalid order quantity");
    if (!Number.isFinite(request.price) || request.price <= 0) throw new Error("invalid order price");
    if (typeof request.clientOrderId !== "string" || !request.clientOrderId) throw new Error("invalid client order id");
    const result = await this.#request("/orders", { method: "POST", body: request });
    if (typeof result.exchangeOrderId !== "string" || !result.exchangeOrderId) throw new Error("sandbox exchange missing exchangeOrderId");
    return { ...result, mode: this.mode };
  }

  async getOrder(exchangeOrderId) {
    if (typeof exchangeOrderId !== "string" || !exchangeOrderId) throw new Error("invalid exchange order id");
    return this.#request(`/orders/${encodeURIComponent(exchangeOrderId)}`);
  }

  async reconcile(exchangeOrderId) {
    const order = await this.getOrder(exchangeOrderId);
    if (!order || typeof order.status !== "string") throw new Error("sandbox exchange returned invalid order state");
    return { ...order, terminal: TERMINAL_STATUSES.has(order.status) };
  }

  async cancelOrder(exchangeOrderId) {
    if (typeof exchangeOrderId !== "string" || !exchangeOrderId) throw new Error("invalid exchange order id");
    return this.#request(`/orders/${encodeURIComponent(exchangeOrderId)}/cancel`, { method: "POST" });
  }
}
