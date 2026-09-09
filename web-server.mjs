import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PaperExchange } from './src/paper-exchange.js';
import { PaperTradingApi } from './src/paper-trading-api.js';
import { createMasterProfile, createFollowerSubscription, addSubscription } from './src/master-follower.js';
import { AccountSecurity, KYC_LEVELS } from './src/account-security.js';

const uiPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web', 'index.html');

export function createWebServer({ exchange = new PaperExchange(), accountSecurity = new AccountSecurity(), demoOnly = false } = {}) {
  if (process.env.NODE_ENV === 'production' && !demoOnly && !accountSecurity.humanChallengeVerifier) throw new Error('production requires a human-challenge verifier');
  const api = new PaperTradingApi({ paperExchange: exchange, accounts: [{ accountId: 'demo' }] });
  const users = new Map([['demo', { userId: 'demo', name: 'کاربر دمو', role: 'FOLLOWER', kycLevel: KYC_LEVELS.UNVERIFIED }]]);
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
  const accountFromToken = (req) => accountSecurity.authenticate(token(req)).account;
  const userProfile = (accountId) => users.get(accountId) || { userId: accountId, name: 'کاربر', role: 'FOLLOWER', kycLevel: KYC_LEVELS.UNVERIFIED };

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(await readFile(uiPath, 'utf8')); return; }
      if (req.method === 'GET' && req.url === '/health') { json(res, 200, { ok: true, service: 'copy-trading-web', paper: true, auth: true }); return; }
      if (req.method === 'POST' && req.url === '/api/auth/register') { json(res, 201, { ok: true, account: accountSecurity.register(await body(req)) }); return; }
      if (req.method === 'POST' && req.url === '/api/auth/login') { json(res, 200, { ok: true, ...accountSecurity.login(await body(req)) }); return; }
      if (req.method === 'POST' && req.url === '/api/auth/logout') { accountSecurity.authenticate(token(req)); json(res, 200, accountSecurity.logout(token(req))); return; }
      if (req.method === 'GET' && req.url === '/api/me') { json(res, 200, accountFromToken(req)); return; }
      if (req.method === 'PATCH' && req.url === '/api/profile') { json(res, 200, accountSecurity.updateProfile(token(req), await body(req))); return; }
      if (req.method === 'POST' && req.url === '/api/session') { json(res, 200, api.createSession({ accountId: 'demo' })); return; }
      if (req.method === 'GET' && req.url === '/api/profile') { const session = ensureSession(req); json(res, 200, { ...userProfile(session.accountId), mode: 'DEMO' }); return; }
      if (req.method === 'GET' && req.url === '/api/masters') { json(res, 200, Array.from(masters.values()).map(m => ({ ...m, ...stats.get(m.masterId) }))); return; }
      const masterMatch = req.url?.match(/^\/api\/masters\/([^/]+)$/);
      if (req.method === 'GET' && masterMatch) { const master = masters.get(masterMatch[1]); if (!master) return json(res, 404, { error: 'master not found' }); json(res, 200, { ...master, ...stats.get(master.masterId) }); return; }
      if (req.method === 'GET' && req.url === '/api/dashboard') { const session = ensureSession(req); const dashboard = api.dashboard({ token: token(req) }); const following = Array.from(subscriptions.values()).filter(s => s.followerId === session.accountId).map(s => ({ ...s, master: { ...masters.get(s.masterId), ...stats.get(s.masterId) } })); json(res, 200, { ...dashboard, profile: userProfile(session.accountId), following }); return; }
      if (req.method === 'POST' && req.url === '/api/copy') { const session = ensureSession(req); const input = await body(req); const master = masters.get(input.masterId); if (!master) return json(res, 404, { error: 'master not found' }); if ((input.mode || 'DEMO') === 'LIVE') accountSecurity.requireKyc(token(req)); const subscription = createFollowerSubscription({ followerId: session.accountId, masterId: master.masterId, mode: input.mode || 'DEMO', allocation: Number(input.allocation || 1), maxRiskPercent: Number(input.maxRiskPercent || 100) }); addSubscription(subscriptions, subscription); json(res, 201, { ok: true, subscription: { ...subscription, exchangeAdapter: undefined } }); return; }
      if (req.method === 'DELETE' && masterMatch) { const session = ensureSession(req); const key = `${session.accountId}:${masterMatch[1]}`; if (!subscriptions.delete(key)) return json(res, 404, { error: 'subscription not found' }); json(res, 200, { ok: true }); return; }
      if (req.method === 'POST' && req.url === '/api/orders') { ensureSession(req); const input = await body(req); json(res, 201, api.placeOrder({ token: token(req), ...input })); return; }
      json(res, 404, { error: 'not found' });
    } catch (error) { const message = error?.message || 'request failed'; const status = /unauthorized|invalid credentials/.test(message) ? 401 : /human verification required|phone verification failed|identity verification required/.test(message) ? 403 : /already exists|already subscribed/.test(message) ? 409 : /not found/.test(message) ? 404 : /production requires/.test(message) ? 503 : 400; json(res, status, { error: message }); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createWebServer().listen(port, () => console.log(`Copy Trading web listening on :${port}`));
}
