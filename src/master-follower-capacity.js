export class MasterFollowerCapacity {
  constructor({ maxActive = 2 } = {}) {
    if (!Number.isInteger(maxActive) || maxActive < 1) throw new Error('invalid maxActive');
    this.maxActive = maxActive;
    this.masters = new Map();
  }

  join({ masterId, followerId } = {}) {
    if (!masterId || !followerId) throw new Error('masterId and followerId are required');
    const state = this.#state(masterId);
    if (state.active.has(followerId)) return { status: 'active', position: null, duplicate: true };
    if (state.queue.includes(followerId)) return { status: 'queued', position: state.queue.indexOf(followerId) + 1, duplicate: true };
    if (state.active.size < this.maxActive) {
      state.active.add(followerId);
      return { status: 'active', position: null, duplicate: false };
    }
    state.queue.push(followerId);
    return { status: 'queued', position: state.queue.length, duplicate: false };
  }

  leave({ masterId, followerId } = {}) {
    const state = this.#state(masterId);
    if (state.active.delete(followerId)) return this.#promote(masterId, state);
    const index = state.queue.indexOf(followerId);
    if (index >= 0) {
      state.queue.splice(index, 1);
      return { removed: true, promoted: null };
    }
    return { removed: false, promoted: null };
  }

  snapshot(masterId) {
    const state = this.#state(masterId);
    return { maxActive: this.maxActive, active: [...state.active], queue: [...state.queue] };
  }

  #promote(masterId, state) {
    const promoted = state.active.size < this.maxActive ? state.queue.shift() || null : null;
    if (promoted) state.active.add(promoted);
    return { removed: true, promoted, snapshot: this.snapshot(masterId) };
  }

  #state(masterId) {
    if (!this.masters.has(masterId)) this.masters.set(masterId, { active: new Set(), queue: [] });
    return this.masters.get(masterId);
  }
}
