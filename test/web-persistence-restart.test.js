import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createWebServer } from '../web-server.mjs';

async function start(statePath) {
  const server = createWebServer({ statePath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function stop(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function jsonRequest(base, method, url, payload, token) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  return { status: response.status, body: await response.json() };
}

test('web account and DEMO subscription survive a real server restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'copy-trading-web-'));
  const statePath = path.join(dir, 'state.json');
  let first;
  let second;
  try {
    first = await start(statePath);
    const phone = '+989121234567';
    const password = 'StrongPassword123!';

    const registered = await jsonRequest(first.base, 'POST', '/api/auth/register', { phone, password, name: 'Restart User' });
    assert.equal(registered.status, 201);

    const loggedIn = await jsonRequest(first.base, 'POST', '/api/auth/login', { phone, password });
    assert.equal(loggedIn.status, 200);
    const token = loggedIn.body.token;

    const copied = await jsonRequest(first.base, 'POST', '/api/copy', { masterId: 'm1', mode: 'DEMO' }, token);
    assert.equal(copied.status, 201);
    assert.equal(copied.body.subscription.masterId, 'm1');

    await stop(first);
    first = null;

    second = await start(statePath);
    const relogged = await jsonRequest(second.base, 'POST', '/api/auth/login', { phone, password });
    assert.equal(relogged.status, 200);

    const dashboard = await jsonRequest(second.base, 'GET', '/api/dashboard', undefined, relogged.body.token);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.following.length, 1);
    assert.equal(dashboard.body.following[0].masterId, 'm1');
    assert.equal(dashboard.body.following[0].mode, 'DEMO');

    const stopped = await jsonRequest(second.base, 'DELETE', '/api/masters/m1', undefined, relogged.body.token);
    assert.equal(stopped.status, 200);
  } finally {
    if (first) await stop(first);
    if (second) await stop(second);
    await rm(dir, { recursive: true, force: true });
  }
});
