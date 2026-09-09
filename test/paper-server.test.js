import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaperServer } from '../paper-server.mjs';

test('paper trading HTTP API serves health, UI, session, order and dashboard', async () => {
  const server = createPaperServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, mode: 'PAPER' });
    const ui = await fetch(`${base}/`);
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /Paper Trading/);
    const session = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: 'demo' }) });
    assert.equal(session.status, 200);
    const { token } = await session.json();
    const order = await fetch(`${base}/api/orders`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1, price: 100, clientOrderId: 'http-1' }) });
    assert.equal(order.status, 201);
    const dashboard = await fetch(`${base}/api/dashboard`, { headers: { authorization: `Bearer ${token}` } });
    const data = await dashboard.json();
    assert.equal(data.mode, 'PAPER');
    assert.equal(data.orderCount, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});