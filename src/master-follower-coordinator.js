import { FollowerCapacityQueue } from "./follower-capacity-queue.js";

const CAPACITY = 2;

export class MasterFollowerCoordinator {
  constructor({ queue = new FollowerCapacityQueue({ capacity: CAPACITY }) } = {}) {
    if (!queue || typeof queue.join !== "function" || typeof queue.getStatus !== "function") {
      throw new Error("invalid follower capacity queue");
    }
    if (queue.capacity !== CAPACITY) throw new Error("demo follower capacity must be 2");
    this.queue = queue;
    this.followers = new Map();
    this.signals = new Map();
    this.audit = [];
  }

  joinFollower({ followerId, pipeline } = {}) {
    if (!followerId || typeof followerId !== "string") throw new Error("invalid follower id");
    if (!pipeline || typeof pipeline.submit !== "function") throw new Error("invalid follower pipeline");

    const status = this.queue.join(followerId);
    if (status.status === "ACTIVE") {
      const existing = this.followers.get(followerId);
      if (existing) return this.statusResponse(status, existing.pipeline);
      this.followers.set(followerId, { followerId, pipeline, slot: status.slot });
      this.record("FOLLOWER_ACTIVATED", { followerId, slot: status.slot });
      return this.statusResponse(status, pipeline);
    }

    this.record("FOLLOWER_WAITLISTED", { followerId, queueId: status.queueId });
    return {
      ...status,
      position: this.queue.getStatus(followerId).position,
      message: "ظرفیت فعلاً تکمیل است؛ لطفاً منتظر بمانید."
    };
  }

  leaveFollower(followerId) {
    if (!followerId || typeof followerId !== "string") throw new Error("invalid follower id");
    const result = this.queue.leave(followerId);
    this.followers.delete(followerId);

    if (result.promoted) {
      const promoted = this.followers.get(result.promoted.userId);
      if (!promoted) {
        this.record("FOLLOWER_PROMOTION_PENDING", { followerId: result.promoted.userId });
      }
    }

    this.record("FOLLOWER_LEFT", { followerId, promoted: result.promoted?.userId ?? null });
    return structuredClone(result);
  }

  attachPromotedFollower({ followerId, pipeline } = {}) {
    if (!followerId || typeof followerId !== "string") throw new Error("invalid follower id");
    if (!pipeline || typeof pipeline.submit !== "function") throw new Error("invalid follower pipeline");
    const status = this.queue.getStatus(followerId);
    if (status.status !== "ACTIVE") throw new Error("follower is not active");
    if (this.followers.has(followerId)) return this.statusResponse(status, this.followers.get(followerId).pipeline);
    this.followers.set(followerId, { followerId, pipeline, slot: status.slot });
    this.record("FOLLOWER_ATTACHED_AFTER_PROMOTION", { followerId, slot: status.slot });
    return this.statusResponse(status, pipeline);
  }

  publishSignal({ masterSignalId, symbol, side, quantity, price, timeoutMs = 5000 } = {}) {
    if (!masterSignalId || typeof masterSignalId !== "string") throw new Error("invalid master signal id");
    if (!symbol || typeof symbol !== "string") throw new Error("invalid symbol");
    if (side !== "BUY" && side !== "SELL") throw new Error("invalid side");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid quantity");
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid price");
    if (this.signals.has(masterSignalId)) return structuredClone(this.signals.get(masterSignalId));

    const active = [...this.followers.values()].sort((a, b) => a.slot - b.slot);
    const results = [];
    for (const follower of active) {
      const copyOrderId = `COPY-${masterSignalId}-${follower.followerId}`;
      let result;
      try {
        result = follower.pipeline.submit({
          symbol,
          side,
          quantity,
          price,
          timeoutMs,
          clientOrderId: copyOrderId
        });
      } catch (error) {
        result = {
          accepted: false,
          status: "EXECUTION_ERROR",
          error: String(error?.message ?? error)
        };
      }
      results.push({ followerId: follower.followerId, copyOrderId, result: structuredClone(result) });
      this.record("FOLLOWER_SIGNAL_RESULT", {
        masterSignalId,
        followerId: follower.followerId,
        copyOrderId,
        status: result.status ?? null
      });
    }

    const response = { masterSignalId, status: "PROCESSED", followerResults: results };
    this.signals.set(masterSignalId, response);
    this.record("MASTER_SIGNAL_PROCESSED", {
      masterSignalId,
      followerCount: results.length
    });
    return structuredClone(response);
  }

  getFollowerStatus(followerId) {
    return this.queue.getStatus(followerId);
  }

  getAuditLog() {
    return structuredClone(this.audit);
  }

  statusResponse(status, pipeline) {
    return {
      ...structuredClone(status),
      message: "Follower فعال شد.",
      pipelineAttached: Boolean(pipeline)
    };
  }

  record(type, payload) {
    this.audit.push({ type, payload: structuredClone(payload), recordedAt: this.audit.length });
  }
}
