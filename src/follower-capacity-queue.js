export class FollowerCapacityQueue {
  constructor({ capacity = 2 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("invalid follower capacity");
    this.capacity = capacity;
    this.active = new Map();
    this.waiting = new Map();
    this.nextQueueId = 1;
  }

  join(userId) {
    if (!userId || typeof userId !== "string") throw new Error("invalid user id");

    const active = this.active.get(userId);
    if (active) return structuredClone(active);

    const waiting = this.waiting.get(userId);
    if (waiting) return structuredClone(waiting);

    if (this.active.size < this.capacity) {
      const entry = { userId, status: "ACTIVE", slot: this.active.size + 1 };
      this.active.set(userId, entry);
      return structuredClone(entry);
    }

    const entry = {
      userId,
      status: "WAITLISTED",
      queueId: `QUEUE-${this.nextQueueId++}`
    };
    this.waiting.set(userId, entry);
    return structuredClone(entry);
  }

  leave(userId) {
    if (!userId || typeof userId !== "string") throw new Error("invalid user id");

    if (this.waiting.delete(userId)) return { userId, status: "REMOVED_FROM_QUEUE" };

    if (!this.active.has(userId)) return { userId, status: "NOT_FOUND" };

    this.active.delete(userId);
    const promoted = this.promoteNext();
    return { userId, status: "RELEASED", promoted };
  }

  promoteNext() {
    if (this.active.size >= this.capacity || this.waiting.size === 0) return null;

    const [userId, waiting] = this.waiting.entries().next().value;
    this.waiting.delete(userId);
    const entry = { userId, status: "ACTIVE", slot: this.active.size + 1, queueId: waiting.queueId };
    this.active.set(userId, entry);
    return structuredClone(entry);
  }

  getStatus(userId) {
    if (this.active.has(userId)) return structuredClone(this.active.get(userId));
    if (this.waiting.has(userId)) {
      const entry = this.waiting.get(userId);
      const position = [...this.waiting.keys()].indexOf(userId) + 1;
      return { ...structuredClone(entry), position };
    }
    return { userId, status: "NOT_FOUND" };
  }

  snapshot() {
    return {
      capacity: this.capacity,
      active: [...this.active.values()].map((entry) => structuredClone(entry)),
      waiting: [...this.waiting.values()].map((entry, index) => ({ ...structuredClone(entry), position: index + 1 }))
    };
  }
}
