import assert from 'node:assert/strict';
import { ExirFollowerResolver } from '../src/real/exir-follower-resolver.js';

let request;
const resolver = new ExirFollowerResolver({
  supabaseUrl: 'https://example.supabase.co',
  serviceRoleKey: 'SERVICE_ROLE_SECRET',
  fetchImpl: async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{
        account_id: 'account-1',
        api_key: 'follower-key',
        api_secret: 'follower-secret',
        state: 'verified',
        read_permission: true,
        trade_permission: true,
        withdraw_permission: false
      }])
    };
  }
});

const adapter = await resolver.resolve({ id: 'follower-1' });
assert.equal(typeof adapter.order, 'function');
assert.equal(request.url, 'https://example.supabase.co/rest/v1/rpc/vault_get_exchange_credentials');
assert.equal(request.options.headers.authorization, 'Bearer SERVICE_ROLE_SECRET');
assert.deepEqual(JSON.parse(request.options.body), { p_user_id: 'follower-1', p_exchange: 'exir' });

const blockedResolver = new ExirFollowerResolver({
  supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'SERVICE_ROLE_SECRET',
  fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify([{
    account_id: 'account-2', api_key: 'key', api_secret: 'secret', state: 'verified',
    read_permission: true, trade_permission: true, withdraw_permission: true
  }]) })
});
await assert.rejects(() => blockedResolver.resolve({ id: 'follower-2' }), /withdrawal permission is forbidden/);

const unverifiedResolver = new ExirFollowerResolver({
  supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'SERVICE_ROLE_SECRET',
  fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify([]) })
});
await assert.rejects(() => unverifiedResolver.resolve({ id: 'follower-3' }), /verified Exir account not configured/);

console.log('Exir follower resolver tests passed');
