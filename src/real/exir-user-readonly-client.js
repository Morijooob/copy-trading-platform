/**
 * Boundary for the authenticated user's Exir account.
 * The implementation is intentionally injected so secrets stay server-side.
 */
export class ExirUserReadonlyClient {
  constructor({ getAccount }) {
    if (typeof getAccount !== 'function') throw new TypeError('getAccount function is required');
    this._getAccount = getAccount;
  }

  async getAccount({ userId, accountId }) {
    if (!userId || !accountId) throw new Error('user and account are required');
    const result = await this._getAccount({ userId, accountId });
    return Object.freeze({
      state: result?.state ?? 'unknown',
      available: result?.available ?? null,
      currency: result?.currency ?? null,
      withdrawPermission: result?.withdrawPermission === true,
    });
  }
}
