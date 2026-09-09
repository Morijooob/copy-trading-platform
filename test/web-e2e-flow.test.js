import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebServer } from '../web-server.mjs';

async function withServer(fn) {
  const server = createWebServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function request(base, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
}

const randomPhone = (prefix) => `+98${prefix}${Math.floor(1000000 + Math.random() * 8999999)}`;

test('full user flow: register -> login -> masters -> copy -> dashboard -> stop -> logout', async () => {
  await withServer(async (base) => {
    const phone = randomPhone('912');
    const password = 'StrongPass123!';

    const register = await request(base, '/api/auth/register', {
      method: 'POST',
      body: { phone, password, name: 'E2E User' }
    });
    assert.equal(register.response.status, 201);
    assert.equal(register.payload.account.name, 'E2E User');

    const login = await request(base, '/api/auth/login', {
      method: 'POST',
      body: { phone, password }
    });
    assert.equal(login.response.status, 200);
    const token = login.payload.token;
    assert.ok(token);

    const masters = await request(base, '/api/masters');
    assert.equal(masters.response.status, 200);
    assert.equal(masters.payload.length, 3);
    assert.ok(masters.payload.some((master) => master.masterId === 'm1'));

    const before = await request(base, '/api/dashboard', { token });
    assert.equal(before.response.status, 200);
    assert.equal(before.payload.profile.name, 'E2E User');
    assert.equal(before.payload.following.length, 0);

    const copy = await request(base, '/api/copy', {
      method: 'POST',
      token,
      body: { masterId: 'm1', mode: 'DEMO', allocation: 1, maxRiskPercent: 25 }
    });
    assert.equal(copy.response.status, 201);
    assert.equal(copy.payload.subscription.masterId, 'm1');
    assert.equal(copy.payload.subscription.mode, 'DEMO');

    const afterCopy = await request(base, '/api/dashboard', { token });
    assert.equal(afterCopy.response.status, 200);
    assert.equal(afterCopy.payload.following.length, 1);
    assert.equal(afterCopy.payload.following[0].masterId, 'm1');

    const stop = await request(base, '/api/masters/m1', { method: 'DELETE', token });
    assert.equal(stop.response.status, 200);

    const afterStop = await request(base, '/api/dashboard', { token });
    assert.equal(afterStop.response.status, 200);
    assert.equal(afterStop.payload.following.length, 0);

    const logout = await request(base, '/api/auth/logout', { method: 'POST', token });
    assert.equal(logout.response.status, 200);

    const expired = await request(base, '/api/dashboard', { token });
    assert.equal(expired.response.status, 401);
  });
});

test('two users remain isolated when copying the same master', async () => {
  await withServer(async (base) => {
    const users = [
      { phone: randomPhone('912'), name: 'User A' },
      { phone: randomPhone('935'), name: 'User B' }
    ];
    const password = 'StrongPass123!';
    const accounts = [];
    const tokens = [];

    for (const user of users) {
      const register = await request(base, '/api/auth/register', {
        method: 'POST',
        body: { ...user, password }
      });
      assert.equal(register.response.status, 201);
      accounts.push(register.payload.account);
      const login = await request(base, '/api/auth/login', {
        method: 'POST',
        body: { phone: user.phone, password }
      });
      assert.equal(login.response.status, 200);
      tokens.push(login.payload.token);
    }

    const firstCopy = await request(base, '/api/copy', {
      method: 'POST', token: tokens[0], body: { masterId: 'm1', mode: 'DEMO' }
    });
    assert.equal(firstCopy.response.status, 201);

    const firstDashboard = await request(base, '/api/dashboard', { token: tokens[0] });
    const secondDashboard = await request(base, '/api/dashboard', { token: tokens[1] });
    assert.equal(firstDashboard.payload.following.length, 1);
    assert.equal(secondDashboard.payload.following.length, 0);

    const secondCopy = await request(base, '/api/copy', {
      method: 'POST', token: tokens[1], body: { masterId: 'm1', mode: 'DEMO' }
    });
    assert.equal(secondCopy.response.status, 201);

    const finalFirst = await request(base, '/api/dashboard', { token: tokens[0] });
    const finalSecond = await request(base, '/api/dashboard', { token: tokens[1] });
    assert.equal(finalFirst.payload.following.length, 1);
    assert.equal(finalSecond.payload.following.length, 1);
    assert.equal(finalFirst.payload.following[0].followerId, accounts[0].userId);
    assert.equal(finalSecond.payload.following[0].followerId, accounts[1].userId);
    assert.notEqual(finalFirst.payload.following[0].followerId, finalSecond.payload.following[0].followerId);
  });
});
