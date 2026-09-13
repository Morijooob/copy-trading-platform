import assert from 'node:assert/strict';
import { ExecutionProofChain } from '../src/execution-proof-chain.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runFollowerRace(followerCount) {
  const chain = new ExecutionProofChain();
  const masterId = `master-race-${followerCount}`;
  const riskSnapshot = { version: 'risk-v1', hash: 'risk-hash-v1' };

  // Intent sequence is a monotonic per-master contract. Network-style concurrency
  // must therefore begin after the ordered sequence has been admitted; otherwise
  // an out-of-order arrival is correctly rejected by the proof chain.
  const intents = [];
  for (let index = 0; index < followerCount; index += 1) {
    const followerId = `follower-${index + 1}`;
    const signalId = `signal-${index + 1}`;
    await sleep((index * 7) % 13);
    intents.push(chain.createIntent({
      masterId,
      followerId,
      signalId,
      sequence: index + 1,
      side: 'buy',
      symbol: 'BTC/USDT',
      quantity: 0.001,
      riskSnapshot,
    }));
  }

  const results = await Promise.all(
    intents.map(async (intent, index) => {
      await sleep((followerCount - index) % 11);
      const ack = chain.acknowledge({
        idempotencyKey: intent.idempotencyKey,
        exchangeOrderId: `ex-order-${index + 1}`,
        riskSnapshot,
      });
      await sleep((index + 3) % 9);
      const fill = chain.recordFill({
        idempotencyKey: intent.idempotencyKey,
        exchangeOrderId: ack.exchangeOrderId,
        fillId: `fill-${index + 1}`,
        quantity: 0.001,
        price: 100000,
      });
      const ledger = chain.reconcileLedger({ fillId: fill.fillId, ledgerId: `ledger-${index + 1}` });
      return { intent, ack, fill, ledger, proof: chain.assertReconciled(intent.idempotencyKey) };
    }),
  );

  assert.equal(results.length, followerCount);
  assert.equal(new Set(results.map((r) => r.intent.idempotencyKey)).size, followerCount);
  assert.equal(new Set(results.map((r) => r.ack.exchangeOrderId)).size, followerCount);
  assert.equal(new Set(results.map((r) => r.fill.fillId)).size, followerCount);
  assert.equal(new Set(results.map((r) => r.ledger.ledgerId)).size, followerCount);
  assert.deepEqual(results.map((r) => r.intent.sequence).sort((a, b) => a - b), Array.from({ length: followerCount }, (_, i) => i + 1));
  assert.ok(results.every((r) => r.proof.ok === true));
}

async function runDuplicateBoundaryRace() {
  const chain = new ExecutionProofChain();
  const riskSnapshot = { version: 'risk-v1', hash: 'risk-hash-v1' };
  const args = {
    masterId: 'master-duplicate-race', followerId: 'follower-1', signalId: 'signal-1', sequence: 1,
    side: 'buy', symbol: 'BTC/USDT', quantity: 0.001, riskSnapshot,
  };

  const intents = await Promise.all(Array.from({ length: 32 }, async () => {
    await sleep(Math.floor(Math.random() * 5));
    return chain.createIntent(args);
  }));
  assert.equal(intents.filter((x) => !x.duplicate).length, 1);
  assert.equal(intents.filter((x) => x.duplicate).length, 31);

  const key = intents[0].idempotencyKey;
  const acknowledgements = await Promise.all(Array.from({ length: 32 }, async (_, i) => {
    await sleep(Math.floor(Math.random() * 5));
    return chain.acknowledge({ idempotencyKey: key, exchangeOrderId: 'ex-order-1', riskSnapshot });
  }));
  assert.equal(new Set(acknowledgements.map((x) => x.exchangeOrderId)).size, 1);

  const fills = await Promise.all(Array.from({ length: 32 }, async () => {
    await sleep(Math.floor(Math.random() * 5));
    return chain.recordFill({ idempotencyKey: key, exchangeOrderId: 'ex-order-1', fillId: 'fill-1', quantity: 0.001, price: 100000 });
  }));
  assert.equal(fills.filter((x) => !x.duplicate).length, 1);
  assert.equal(fills.filter((x) => x.duplicate).length, 31);

  const ledgers = await Promise.all(Array.from({ length: 32 }, async () => {
    await sleep(Math.floor(Math.random() * 5));
    return chain.reconcileLedger({ fillId: 'fill-1', ledgerId: 'ledger-1' });
  }));
  assert.equal(ledgers.filter((x) => !x.duplicate).length, 1);
  assert.equal(ledgers.filter((x) => x.duplicate).length, 31);
  assert.deepEqual(chain.assertReconciled(key), { ok: true, intentHash: intents[0].intentHash, fillCount: 1 });
}

await runFollowerRace(2);
await runFollowerRace(8);
await runFollowerRace(16);
await runFollowerRace(32);
await runDuplicateBoundaryRace();

console.log('Execution proof race torture PASSED: 2/8/16/32 followers, concurrent boundaries, duplicate intent/fill/ledger races');
