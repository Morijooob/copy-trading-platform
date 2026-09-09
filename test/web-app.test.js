import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer } from '../web-server.mjs';

async function withServer(fn) {
  const server = createWebServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try { return await fn(`http://127.0.0.1:${port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}

async function request(base, path, options) {
  const res = await fetch(base + path, options);
  const data = await res.json();
  return { status: res.status, data };
}

test('web app health and public masters are available', async () => withServer(async base => {
  const health = await request(base, '/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  const masters = await request(base, '/api/masters');
  assert.equal(masters.status, 200);
  assert.equal(masters.data.length, 3);
  assert.ok(masters.data.every(m => Number.isFinite(m.roi)));
}));

test('demo session, profile, copy subscription and dashboard are connected', async () => withServer(async base => {
  const session = await request(base, '/api/session', { method: 'POST' });
  assert.equal(session.status, 200);
  const auth = { authorization: `Bearer ${session.data.token}` };
  const profile = await request(base, '/api/profile', { headers: auth });
  assert.equal(profile.status, 200);
  assert.equal(profile.data.mode, 'DEMO');
  const copy = await request(base, '/api/copy', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ masterId: 'm1', mode: 'DEMO', allocation: 1, maxRiskPercent: 10 }) });
  assert.equal(copy.status, 201);
  const dashboard = await request(base, '/api/dashboard', { headers: auth });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.data.following.length, 1);
  assert.equal(dashboard.data.following[0].master.masterId, 'm1');
}));

test('duplicate copy is rejected and stop-copy works', async () => withServer(async base => {
  const session = await request(base, '/api/session', { method: 'POST' });
  const auth = { authorization: `Bearer ${session.data.token}` };
  const opts = { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ masterId: 'm2', mode: 'DEMO', allocation: 1 }) };
  assert.equal((await request(base, '/api/copy', opts)).status, 201);
  assert.equal((await request(base, '/api/copy', opts)).status, 409);
  assert.equal((await request(base, '/api/masters/m2', { method: 'DELETE', headers: auth })).status, 200);
  const dashboard = await request(base, '/api/dashboard', { headers: auth });
  assert.equal(dashboard.data.following.length, 0);
}));
