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
    return { confirmed: true, exchangeOrderId: "ex-after-restart" };
  }
});

const recovered = restarted.recoverAfterRestart();
assert.equal(recovered.length, 1);
assert.equal(recovered[0].status, "CONFIRMED");
assert.equal(recovered[0].exchangeOrderId, "ex-after-restart");
assert.equal(reconcileCalls, 1);
assert.equal(submitCalls, 1);

const duplicate = restarted.execute({ clientRequestId: "restart-1", order });
assert.equal(duplicate.status, "CONFIRMED");
assert.equal(submitCalls, 1);

console.log("Restart recovery tests passed");
