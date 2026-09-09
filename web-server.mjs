import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { PaperExchange } from './src/paper-exchange.js';
import { PaperTradingApi } from './src/paper-trading-api.js';
import { createMasterProfile, createFollowerSubscription, addSubscription } from './src/master-follower.js';

const uiPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web', 'index.html');

export function createWebServer({ exchange = new PaperExchange() } = {}) {
  const api = new PaperTradingApi({ paperExchange: exchange, accounts: [{ accountId: 'demo' }] });
  const users = new Map([['demo', { userId: 'demo', name: 'کاربر دمو', role: 'FOLLOWER' }]]);
  const masters = new Map([
    ['m1', createMasterProfile({ masterId: 'm1', name: 'Alpha Master', strategy: 'Trend Following', riskProfile: 'MEDIUM' })],
    ['m2', createMasterProfile({ masterId: 'm2', name: 'Crypto Pro', strategy: 'Momentum', riskProfile: 'HIGH' })],
    ['m3', createMasterProfile({ masterId: 'm3', name: 'Steady BTC', strategy: 'Conservative', riskProfile: 'LOW' })]
  ]);
  const subscriptions = new Map();
  const stats = new Map([['m1', { roi: 38.4, pnl: 3840, drawdown: 8.2, followers: 128, winRate: 71 }], ['m2', { roi: 54.7, pnl: 5470, drawdown: 18.4, followers: 96, winRate: 68 }], ['m3', { roi: 21.8, pnl: 2180, drawdown: 4.7, followers: 211, winRate: 76 }]]);
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const body = async (req) => { let data = ''; for await (const chunk of req) data += chunk; return data ? JSON.parse(data) : {}; };
  const token = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ensureSession = (req) => api.authenticate(token(req));
  const userProfile = (accountId) => users.get(accountId) || { userId: accountId, name: 'کاربر', role: 'FOLLOWER' };

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(await readFile(uiPath, 'utf8')); return; }
      if (req.method === 'GET' && req.url === '/health') { json(res, 200, { ok: true, service: 'copy-trading-web', paper: true }); return; }
      if (req.method === 'POST' && req.url === '/api/session') { json(res, 200, api.createSession({ accountId: 'demo' })); return; }
      if (req.method === 'GET' && req.url === '/api/profile') { const session = ensureSession(req); json(res, 200, { ...userProfile(session.accountId), mode: 'DEMO' }); return; }
      if (req.method === 'GET' && req.url === '/api/masters') { json(res, 200, Array.from(masters.values()).map(m => ({ ...m, ...stats.get(m.masterId) }))); return; }
      const masterMatch = req.url?.match(/^\/api\/masters\/([^/]+)$/);
      if (req.method === 'GET' && masterMatch) { const master = masters.get(masterMatch[1]); if (!master) return json(res, 404, { error: 'master not found' }); json(res, 200, { ...master, ...stats.get(master.masterId) }); return; }
      if (req.method === 'GET' && req.url === '/api/dashboard') { const session = ensureSession(req); const dashboard = api.dashboard({ token: token(req) }); const following = Array.from(subscriptions.values()).filter(s => s.followerId === session.accountId).map(s => ({ ...s, master: { ...masters.get(s.masterId), ...stats.get(s.masterId) } })); json(res, 200, { ...dashboard, profile: userProfile(session.accountId), following }); return; }
      if (req.method === 'POST' && req.url === '/api/copy') {
        const session = ensureSession(req); const input = await body(req); const master = masters.get(input.masterId); if (!master) return json(res, 404, { error: 'master not found' });
        const subscription = createFollowerSubscription({ followerId: session.accountId, masterId: master.masterId, mode: input.mode || 'DEMO', allocation: Number(input.allocation || 1), maxRiskPercent: Number(input.maxRiskPercent || 100) });
        addSubscription(subscriptions, subscription); json(res, 201, { ok: true, subscription: { ...subscription, exchangeAdapter: undefined } }); return;
      }
      if (req.method === 'DELETE' && masterMatch) { const session = ensureSession(req); const key = `${session.accountId}:${masterMatch[1]}`; if (!subscriptions.delete(key)) return json(res, 404, { error: 'subscription not found' }); json(res, 200, { ok: true }); return; }
      if (req.method === 'POST' && req.url === '/api/orders') { ensureSession(req); const input = await body(req); json(res, 201, api.placeOrder({ token: token(req), ...input })); return; }
      json(res, 404, { error: 'not found' });
    } catch (error) { const message = error?.message || 'request failed'; const status = /unauthorized/.test(message) ? 401 : /not found/.test(message) ? 404 : /already subscribed/.test(message) ? 409 : 400; json(res, status, { error: message }); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createWebServer().listen(port, () => console.log(`Copy Trading web listening on :${port}`));
}
