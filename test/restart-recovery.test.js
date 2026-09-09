import assert from "node:assert/strict";
import { PersistentNetworkResilience } from "../src/persistent-network-resilience.js";
import { NetworkPersistenceStore } from "../src/network-persistence-store.js";

const order = { symbol: "BTCUSDT", side: "BUY", quantity: 1 };
const store = new NetworkPersistenceStore();
let submitCalls = 0;

const first = new PersistentNetworkResilience({
  store,
  submit: () => {
    submitCalls += 1;
    throw new Error("response lost after acceptance");
  },
  reconcile: () => ({ confirmed: false })
});

const unknown = first.execute({ clientRequestId: "restart-1", order });
assert.equal(unknown.status, "UNKNOWN");
assert.equal(submitCalls, 1);

let reconcileCalls = 0;
const restarted = new PersistentNetworkResilience({
  store,
  submit: () => {
    submitCalls += 1;
    return { accepted: true, exchangeOrderId: "should-not-happen" };
  },
  reconcile: () => {
    reconcileCalls += 1;
    return { confirmed: true, exchangeOrderId: "ex-after-restart", filledQty: 0.4 };
  }
});

const recovered = restarted.recoverAfterRestart();
assert.equal(recovered.length, 1);
assert.equal(recovered[0].status, "CONFIRMED");
assert.equal(recovered[0].exchangeOrderId, "ex-after-restart");
assert.equal(recovered[0].filledQty, 0.4);
assert.equal(reconcileCalls, 1);
assert.equal(submitCalls, 1);

const duplicate = restarted.execute({ clientRequestId: "restart-1", order });
assert.equal(duplicate.status, "CONFIRMED");
assert.equal(submitCalls, 1);

const absentStore = new NetworkPersistenceStore();
let retrySubmitCalls = 0;
const absentFirst = new PersistentNetworkResilience({
  store: absentStore,
  submit: () => {
    retrySubmitCalls += 1;
    throw new Error("connection lost");
  },
  reconcile: () => ({ confirmed: false })
});
absentFirst.execute({ clientRequestId: "restart-absent", order });

const absentRestart = new PersistentNetworkResilience({
  store: absentStore,
  submit: () => {
    retrySubmitCalls += 1;
    return { accepted: true, exchangeOrderId: "ex-retry" };
  },
  reconcile: () => ({ confirmed: false })
});
const absentRecovered = absentRestart.recoverAfterRestart();
assert.equal(absentRecovered[0].status, "UNKNOWN");
const retried = absentRestart.retry("restart-absent");
assert.equal(retried.status, "CONFIRMED");
assert.equal(retried.exchangeOrderId, "ex-retry");
assert.equal(retrySubmitCalls, 2);

const ambiguous = new PersistentNetworkResilience({
  store: new NetworkPersistenceStore(),
  submit: () => ({ accepted: true, exchangeOrderId: "ex-ambiguous" }),
  reconcile: () => ({ confirmed: "maybe" })
});
ambiguous.execute({ clientRequestId: "ambiguous-1", order });
assert.throws(() => ambiguous.recoverAfterRestart(), /invalid reconciliation response/);

console.log("Restart recovery tests passed");
