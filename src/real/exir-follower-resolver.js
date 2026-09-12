import { ExirAdapter } from '../exir-adapter.js';

const TRUE = 'true';

/**
 * Server-only resolver. It uses the Supabase service role to call the
 * server-only Vault RPC and constructs an Exir adapter for exactly one
 * verified follower account. Credentials never enter browser code or logs.
 */
export class ExirFollowerResolver {
  constructor({ supabaseUrl, serviceRoleKey, fetchImpl = globalThis.fetch, exirBaseUrl = undefined } = {}) {
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase server credentials are required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
    this.supabaseUrl = String(supabaseUrl).replace(/\/$/, '');
    this.serviceRoleKey = String(serviceRoleKey);
    this.fetchImpl = fetchImpl;
    this.exirBaseUrl = exirBaseUrl;
  }

  async resolve(follower) {
    const userId = follower?.userId || follower?.id;
    if (!userId) throw new Error('follower user id required');

    const response = await this.fetchImpl(`${this.supabaseUrl}/rest/v1/rpc/vault_get_exchange_credentials`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ p_user_id: userId, p_exchange: 'exir' })
    });

    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new Error(`exchange credential lookup failed with HTTP ${response.status}`);
    if (!Array.isArray(data) || data.length !== 1) throw new Error('verified Exir account not configured');

    const account = data[0];
    if (account.state !== 'verified' || account.read_permission !== true || account.trade_permission !== true) {
      throw new Error('follower Exir account is not trade-ready');
    }
    if (account.withdraw_permission === true) {
      throw new Error('withdrawal permission is forbidden for copy trading');
    }
    if (!account.api_key || !account.api_secret) throw new Error('follower Exir credentials unavailable');

    return new ExirAdapter({
      apiKey: account.api_key,
      apiSecret: account.api_secret,
      baseUrl: this.exirBaseUrl,
      fetchImpl: this.fetchImpl
    });
  }

  static fromEnv({ fetchImpl = fetch } = {}) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
    return new ExirFollowerResolver({
      supabaseUrl: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      exirBaseUrl: process.env.EXIR_API_BASE_URL || undefined,
      fetchImpl
    });
  }
}
