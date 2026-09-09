import http from 'node:http';
import { PaperExchange } from './src/paper-exchange.js';
import { PaperTradingApi } from './src/paper-trading-api.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function createPaperServer({ exchange = new PaperExchange(), api = null } = {}) {
  const tradingApi = api || new PaperTradingApi({ paperExchange: exchange, accounts: [{ accountId: 'demo' }] });
  const uiPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'paper-ui', 'index.html');
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const body = async (req) => { let data = ''; for await (const chunk of req) data += chunk; return data ? JSON.parse(data) : {}; };
  const token = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(await readFile(uiPath, 'utf8')); return; }
      if (req.method === 'GET' && req.url === '/health') { json(res, 200, { ok: true, mode: 'PAPER' }); return; }
      if (req.method === 'POST' && req.url === '/api/session') { const result = tradingApi.createSession(await body(req)); json(res, 200, result); return; }
      if (req.method === 'POST' && req.url === '/api/orders') { const result = tradingApi.placeOrder({ token: token(req), ...(await body(req)) }); json(res, 201, result); return; }
      if (req.method === 'GET' && req.url === '/api/dashboard') { json(res, 200, tradingApi.dashboard({ token: token(req) })); return; }
      const match = req.url?.match(/^\/api\/orders\/(.+)$/);
      if (req.method === 'GET' && match) { json(res, 200, tradingApi.getOrder({ token: token(req), clientOrderId: decodeURIComponent(match[1]) })); return; }
      json(res, 404, { error: 'not found' });
    } catch (error) { const status = /unauthorized/.test(error.message) ? 401 : /not found/.test(error.message) ? 404 : 400; json(res, status, { error: error.message }); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createPaperServer().listen(port, () => console.log(`Paper Trading server listening on :${port}`));
}
