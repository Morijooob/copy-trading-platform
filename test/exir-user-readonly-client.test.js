import assert from 'node:assert/strict';
import { ExirUserReadonlyClient } from '../src/real/exir-user-readonly-client.js';

let called = false;
const client = new ExirUserReadonlyClient({
  getAccount: async ({ userId, accountId }) => { called = true; assert.equal(userId, 'u1'); assert.equal(accountId, 'a1'); return { state: 'verified', available: 12, currency: 'USDT', withdrawPermission: false }; },
});
const result = await client.getAccount({ userId: 'u1', accountId: 'a1' });
assert.equal(called, true);
assert.deepEqual(result, { state: 'verified', available: 12, currency: 'USDT', withdrawPermission: false });
await assert.rejects(() => client.getAccount({ userId: '', accountId: 'a1' }), /user and account are required/);
console.log('exir-user-readonly-client tests passed');
