import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PaperExchange } from './src/paper-exchange.js';
import { PaperTradingApi } from './src/paper-trading-api.js';
import { createMasterProfile, createFollowerSubscription, addSubscription } from './src/master-follower.js';
import { AccountSecurity, KYC_LEVELS } from './src/account-security.js';

const rootPath = path.dirname(fileURLToPath(import.meta.url));
const uiPath = path.join(rootPath, 'web', 'index.html');
const DEFAULT_STATE_PATH = path.join(rootPath, 'data', 'web-state.json');

function readPersistedState(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, users: [], subscriptions: [], accounts: [], loginFailures: [] };
    throw new Error(`failed to load web persistence: ${error.message}`);
  }
}

function writePersistedState(filePath, state) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}

export function createWebServer({ exchange = new PaperExchange(), accountSecurity = new AccountSecurity(), demoOnly = false, statePath = process.env.WEB_STATE_PATH || DEFAULT_STATE_PATH } = {}) {
  if (process.env.NODE_ENV === 'production' && !demoOnly && !accountSecurity.humanChallengeVerifier) throw new Error('production requires a human-challenge verifier');
  const persisted = readPersistedState(statePath);
  if (persisted.version !== 1) throw new Error('unsupported web persistence version');

  const api = new PaperTradingApi({ paperExchange: exchange, accounts: [{ accountId: 'demo' }] });
  const users = new Map([['demo', { userId: 'demo', name: 'کاربر دمو', role: 'FOLLOWER', kycLevel: KYC_LEVELS.UNVERIFIED }]]);
  const masters = new Map([
    ['m1', createMasterProfile({ masterId: 'm1', name: 'Alpha Master', strategy: 'Trend Following', riskProfile: 'MEDIUM' })],
    ['m2', createMasterProfile({ masterId: 'm2', name: 'Crypto Pro', strategy: 'Momentum', riskProfile: 'HIGH' })],
    ['m3', createMasterProfile({ masterId: 'm3', name: 'Steady BTC', strategy: 'Conservative', riskProfile: 'LOW' })]
  ]);
  const subscriptions = new Map();
  const stats = new Map([['m1', { roi: 38.4, pnl: 3840, drawdown: 8.2, followers: 128, winRate: 71 }], ['m2', { roi: 54.7, pnl: 5470, drawdown: 18.4, followers: 96, winRate: 68 }], ['m3', { roi: 21.8, pnl: 2180, drawdown: 4.7, followers: 211, winRate: 76 }]]);

  for (const account of persisted.accounts || []) accountSecurity.accounts.set(account.phone, account);
  for (const [phone, failures] of persisted.loginFailures || []) accountSecurity.loginFailures.set(phone, failures);
  for (const user of persisted.users || []) users.set(user.userId, user);
  for (const subscription of persisted.subscriptions || []) subscriptions.set(`${subscription.followerId}:${subscription.masterId}`, subscription);

  let persistQueue = Promise.resolve();
  const persist = () => {
    const state = {
      version: 1,
      users: Array.from(users.values()).filter(user => user.userId !== 'demo'),
      subscriptions: Array.from(subscriptions.values()),
      accounts: Array.from(accountSecurity.accounts.values()),
      loginFailures: Array.from(accountSecurity.loginFailures.entries())
    };
    persistQueue = persistQueue.then(() => writePersistedState(statePath, state));
    return persistQueue;
  };

  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const body = async (req) => { let data = ''; for await (const chunk of req) data += chunk; return data ? JSON.parse(data) : {}; };
  const token = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ensureSession = (req) => api.authenticate(token(req));
  const accountFromToken = (req) => accountSecurity.authenticate(token(req)).account;
  const syncPaperSession = (auth) => { api.accounts.set(auth.account.userId, { accountId: auth.account.userId }); api.sessions.set(auth.token, { accountId: auth.account.userId, createdAt: Date.now() }); users.set(auth.account.userId, { userId: auth.account.userId, name: auth.account.name, role: auth.account.role, kycLevel: auth.account.kycLevel }); return auth; };
  const syncUserProfile = (account) => { users.set(account.userId, { userId: account.userId, name: account.name, role: account.role, kycLevel: account.kycLevel }); return account; };
  const userProfile = (accountId) => users.get(accountId) || { userId: accountId, name: 'کاربر', role: 'FOLLOWER', kycLevel: KYC_LEVELS.UNVERIFIED };

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(await readFile(uiPath, 'utf8')); return; }
      if (req.method === 'GET' && req.url === '/health') { json(res, 200, { ok: true, service: 'copy-trading-web', paper: true, auth: true, persistence: true }); return; }
      if (req.method === 'POST' && req.url === '/api/auth/register') { const account = syncUserProfile(accountSecurity.register(await body(req))); await persist(); json(res, 201, { ok: true, account }); return; }
      if (req.method === 'POST' && req.url === '/api/auth/login') { json(res, 200, { ok: true, ...syncPaperSession(accountSecurity.login(await body(req))) }); return; }
      if (req.method === 'POST' && req.url === '/api/auth/logout') { const current = token(req); accountSecurity.authenticate(current); api.sessions.delete(current); json(res, 200, accountSecurity.logout(current)); return; }
      if (req.method === 'GET' && req.url === '/api/me') { json(res, 200, accountFromToken(req)); return; }
      if (req.method === 'PATCH' && req.url === '/api/profile') { const account = syncUserProfile(accountSecurity.updateProfile(token(req), await body(req))); await persist(); json(res, 200, account); return; }
      if (req.method === 'POST' && req.url === '/api/session') { json(res, 200, api.createSession({ accountId: 'demo' })); return; }
      if (req.method === 'GET' && req.url === '/api/profile') { const session = ensureSession(req); json(res, 200, { ...userProfile(session.accountId), mode: 'DEMO' }); return; }
      if (req.method === 'GET' && req.url === '/api/masters') { json(res, 200, Array.from(masters.values()).map(m => ({ ...m, ...stats.get(m.masterId) }))); return; }
      const masterMatch = req.url?.match(/^\/api\/masters\/([^/]+)$/);
      if (req.method === 'GET' && masterMatch) { const master = masters.get(masterMatch[1]); if (!master) return json(res, 404, { error: 'master not found' }); json(res, 200, { ...master, ...stats.get(master.masterId) }); return; }
      if (req.method === 'GET' && req.url === '/api/dashboard') { const session = ensureSession(req); const dashboard = api.dashboard({ token: token(req) }); const following = Array.from(subscriptions.values()).filter(s => s.followerId === session.accountId).map(s => ({ ...s, master: { ...masters.get(s.masterId), ...stats.get(s.masterId) } })); json(res, 200, { ...dashboard, profile: userProfile(session.accountId), following }); return; }
      if (req.method === 'POST' && req.url === '/api/copy') { const session = ensureSession(req); const input = await body(req); const master = masters.get(input.masterId); if (!master) return json(res, 404, { error: 'master not found' }); if ((input.mode || 'DEMO') === 'LIVE') accountSecurity.requireKyc(token(req)); const subscription = createFollowerSubscription({ followerId: session.accountId, masterId: master.masterId, mode: input.mode || 'DEMO', allocation: Number(input.allocation || 1), maxRiskPercent: Number(input.maxRiskPercent || 100) }); addSubscription(subscriptions, subscription); await persist(); json(res, 201, { ok: true, subscription: { ...subscription, exchangeAdapter: undefined } }); return; }
      if (req.method === 'DELETE' && masterMatch) { const session = ensureSession(req); const key = `${session.accountId}:${masterMatch[1]}`; if (!subscriptions.delete(key)) return json(res, 404, { error: 'subscription not found' }); await persist(); json(res, 200, { ok: true }); return; }
      if (req.method === 'POST' && req.url === '/api/orders') { ensureSession(req); const input = await body(req); json(res, 201, api.placeOrder({ token: token(req), ...input })); return; }
      json(res, 404, { error: 'not found' });
    } catch (error) { const message = error?.message || 'request failed'; const status = /unauthorized|invalid credentials/.test(message) ? 401 : /human verification required|phone verification failed|identity verification required/.test(message) ? 403 : /already exists|already subscribed/.test(message) ? 409 : /not found/.test(message) ? 404 : /production requires/.test(message) ? 503 : 400; json(res, status, { error: message }); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createWebServer().listen(port, () => console.log(`Copy Trading web listening on :${port}`));
}
