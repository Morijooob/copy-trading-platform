import { RealCopyTradingEngine } from './real-copy-trading-engine.js';

/**
 * Production lifecycle bridge.
 *
 * It mirrors the approved demo lifecycle: OPEN -> HOLD/P&L -> CLOSE -> STOP.
 * The browser never talks to an exchange. The caller supplies master events
 * from a trusted server-side master feed and follower accounts that have
 * already passed admission. Every executable event gets its own idempotency
 * key, and the engine remains fail-closed until every production control is on.
 */
export class RealCopyTradingSession {
  constructor({ engine, masterId, followers = [], audit = () => {} } = {}) {
    if (!(engine instanceof RealCopyTradingEngine)) throw new Error('real copy-trading engine required');
    if (!masterId) throw new Error('masterId required');
    this.engine = engine;
    this.masterId = masterId;
    this.followers = new Map(followers.map((follower) => [follower.id, { ...follower }]));
    this.positions = new Map();
    this.events = [];
    this.audit = audit;
    this.running = false;
  }

  start() {
    this.running = true;
    return this.record({ type: 'START', masterId: this.masterId });
  }

  stop() {
    this.running = false;
    return this.record({ type: 'STOP', masterId: this.masterId });
  }

  addFollower(follower) {
    if (!follower?.id) throw new Error('follower required');
    this.followers.set(follower.id, { ...follower });
  }

  removeFollower(followerId) {
    this.followers.delete(followerId);
  }

  /**
   * Normalize the master feed's side vocabulary at the session boundary.
   * Demo-style LONG/SHORT and exchange-style BUY/SELL are both accepted;
   * everything is converted to the engine's canonical buy/sell form.
   */
  normalizeSide(side) {
    const normalized = String(side || '').trim().toLowerCase();
    if (normalized === 'buy' || normalized === 'long') return 'buy';
    if (normalized === 'sell' || normalized === 'short') return 'sell';
    throw new Error('invalid master side');
  }

  /**
   * Apply one trusted master event to every admitted follower.
   * Event shape: { eventId, type:'OPEN'|'CLOSE'|'HOLD', symbol, side,
   * quantity, price, timestamp, dailyLoss, exposure }.
   */
  async applyMasterEvent(event) {
    if (!event?.eventId) throw new Error('eventId required');
    if (!event?.symbol) throw new Error('symbol required');
    if (!['OPEN', 'CLOSE', 'HOLD'].includes(event.type)) throw new Error('invalid master event type');

    if (event.type === 'HOLD') {
      return this.record({ type: 'HOLD', symbol: event.symbol, price: event.price ?? null, masterEventId: event.eventId });
    }

    if (!this.running) throw new Error('copy-trading session is stopped');
    if (!(Number.isFinite(event.price) && event.price > 0)) throw new Error('invalid master price');

    // OPEN needs the master's direction. CLOSE deliberately does not: the
    // authoritative follower position determines the exit direction. This
    // keeps CLOSE compatible with demo events that contain no side field and
    // prevents a missing/incorrect close-side value from corrupting a position.
    const masterSide = event.type === 'OPEN' ? this.normalizeSide(event.side) : null;

    const results = [];
    for (const follower of this.followers.values()) {
      const current = this.positions.get(`${follower.id}:${event.symbol}`);
      const quantity = event.type === 'CLOSE' ? Number(current?.quantity || 0) : Number(event.quantity);
      if (!(Number.isFinite(quantity) && quantity > 0)) {
        results.push({ followerId: follower.id, skipped: true, reason: 'NO_POSITION_OR_INVALID_QUANTITY' });
        continue;
      }

      const order = {
        symbol: event.symbol,
        side: event.type === 'CLOSE' ? (current.side === 'buy' ? 'sell' : 'buy') : masterSide,
        quantity,
        price: event.price
      };
      const idempotencyKey = `real-copy:${this.masterId}:${event.eventId}:${follower.id}`;
      try {
        const result = await this.engine.executeFollowerOrder({
          idempotencyKey,
          masterId: this.masterId,
          follower,
          order,
          dailyLoss: Number(event.dailyLoss || 0),
          exposure: Number(event.exposure || 0)
        });
        if (event.type === 'OPEN' && !result.duplicate) {
          this.positions.set(`${follower.id}:${event.symbol}`, { side: masterSide, quantity, openedAt: event.timestamp || Date.now() });
        }
        if (event.type === 'CLOSE' && !result.duplicate) this.positions.delete(`${follower.id}:${event.symbol}`);
        results.push({ followerId: follower.id, result });
      } catch (error) {
        results.push({ followerId: follower.id, error: error?.message || String(error) });
        this.audit({ type: 'REAL_COPY_FOLLOWER_ERROR', masterId: this.masterId, followerId: follower.id, masterEventId: event.eventId, error: error?.message || String(error) });
      }
    }

    return this.record({ type: event.type, symbol: event.symbol, masterEventId: event.eventId, results });
  }

  record(event) {
    const result = Object.freeze({ ...event, realCopy: true, at: new Date().toISOString() });
    this.events.push(result);
    this.audit(result);
    return result;
  }

  state() {
    return Object.freeze({
      running: this.running,
      masterId: this.masterId,
      followerCount: this.followers.size,
      positions: Object.fromEntries(this.positions),
      events: [...this.events],
      engine: this.engine.status()
    });
  }
}
