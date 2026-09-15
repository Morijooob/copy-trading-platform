import assert from 'node:assert/strict';
import test from 'node:test';
import { AtomicWalletStore } from '../src/real/atomic-wallet-store.js';
import { WalletLedger } from '../src/real/wallet-ledger.js';

const credit = (ledger, amount) => ledger.credit('user-A', 'USDT', amount, 'test-credit');
const debit = (wallet, amount) => wallet.debit('user-A', 'USDT', amount, 'test-withdrawal');

test('atomic wallet transaction serializes concurrent mutations', async () => {
  const ledger = new WalletLedger();
  credit(ledger, 1000);
  const saves = [];
  const store = new AtomicWalletStore({ ledger, stateStore: { save: async (snapshot) => saves.push(snapshot) } });
  await Promise.all([
    store.transact(async (wallet) => { await new Promise((resolve) => setTimeout(resolve, 5)); debit(wallet, 300); }),
    store.transact(async (wallet) => { debit(wallet, 400); }),
  ]);
  assert.equal(ledger.balance('user-A', 'USDT'), 300);
  assert.equal(saves.length, 2);
});

test('failed durable save rolls the wallet back', async () => {
  const ledger = new WalletLedger();
  credit(ledger, 1000);
  const store = new AtomicWalletStore({ ledger, stateStore: { save: async () => { throw new Error('disk unavailable'); } } });
  await assert.rejects(store.transact(async (wallet) => debit(wallet, 250)), /wallet transaction persistence failed: disk unavailable/);
  assert.equal(ledger.balance('user-A', 'USDT'), 1000);
});

test('queue continues after a failed transaction', async () => {
  const ledger = new WalletLedger();
  credit(ledger, 1000);
  let first = true;
  const store = new AtomicWalletStore({ ledger, stateStore: { save: async () => { if (first) { first = false; throw new Error('temporary failure'); } } } });
  await assert.rejects(store.transact(async (wallet) => debit(wallet, 100)));
  await store.transact(async (wallet) => debit(wallet, 200));
  assert.equal(ledger.balance('user-A', 'USDT'), 800);
});
