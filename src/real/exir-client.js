import crypto from 'node:crypto';

export class ExirClient {
  constructor({ apiKey, apiSecret, baseUrl = 'https://api.exir.io/v2', fetchImpl = fetch } = {}) {
    if (!apiKey || !apiSecret) throw new Error('Exir credentials are required on the server');
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
  }

  signature(method, path, expires, body = '') {
    const payload = `${method.toUpperCase()}${path}${expires}${body}`;
    return crypto.createHmac('sha256', this.apiSecret).update(payload).digest('hex');
  }

  async request(method, path, body) {
    const expires = Math.floor(Date.now() / 1000) + 30;
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'api-key': this.apiKey,
        'api-signature': this.signature(method, path, expires, bodyText),
        'api-expires': String(expires)
      },
      body: body === undefined ? undefined : bodyText
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(`Exir ${res.status}: ${JSON.stringify(data)}`);
    return data;
  }

  balance() { return this.request('GET', '/user/balance'); }
  user() { return this.request('GET', '/user'); }
  order(order) { return this.request('POST', '/order', order); }
  orderStatus(orderId) { return this.request('GET', `/order?order_id=${encodeURIComponent(orderId)}`); }
}
