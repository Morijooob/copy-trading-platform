import assert from "node:assert/strict";
import { PersistenceStore } from "../src/persistence-store.js";

const store = new PersistenceStore();

const saved = store.save({
  nextOrderId: 3,
  nextEventId: 8,
  orders: [
    {
      id: "1",
      clientOrderId: "ct-1",
      status: "UNKNOWN",
      failureState: "NETWORK_UNKNOWN",
      exchangeOrderId: null,
      retryCount: 1,
      lastEventSequence: 4
    }
  ],
  auditLog: [
    { eventId: "1", orderId: "1", type: "SUBMIT_UNKNOWN", eventSequence: 4 }
  ]
});

saved.orders[0].status = "CORRUPTED";
assert.equal(store.load().orders[0].status, "UNKNOWN");
assert.equal(store.load().nextOrderId, 3);
assert.equal(store.load().nextEventId, 8);

const restarted = new PersistenceStore(store.load());
const recovered = restarted.load();
assert.deepEqual(recovered.orders[0], store.load().orders[0]);
assert.deepEqual(recovered.auditLog, store.load().auditLog);

assert.throws(
  () => new PersistenceStore({ ...store.load(), version: 999 }),
  /unsupported persistence version/
);

assert.throws(
  () => store.save({ nextOrderId: 0, nextEventId: 1, orders: [], auditLog: [] }),
  /invalid next order id/
);

console.log("Persistence tests passed");
