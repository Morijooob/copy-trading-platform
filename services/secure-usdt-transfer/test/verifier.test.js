import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyOnChainTransfer } from '../src/verifier.js';

const baseRequest = {
  network: 'BEP20',
  destination: '0x1111111111111111111111111111111111111111',
  amountUsdt: '25.00000000',
  expectedChainId: 56,
  expectedUsdtContract: '0x2222222222222222222222222222222222222222',
  minConfirmations: 12,
};

const baseObserved = {
  chainId: 56,
  tokenContract: baseRequest.expectedUsdtContract,
  from: '0x3333333333333333333333333333333333333333',
  to: baseRequest.destination,
  amountUsdt: '25.00000000',
  confirmations: 12,
  txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

test('accepts a fully matching confirmed BEP20 transfer', () => {
  assert.doesNotThrow(() => verifyOnChainTransfer(baseRequest, baseObserved));
});

test('rejects wrong chain', () => {
  assert.throws(() => verifyOnChainTransfer(baseRequest, { ...baseObserved, chainId: 97 }), /CHAIN_ID_MISMATCH/);
});

test('rejects wrong token contract', () => {
  assert.throws(() => verifyOnChainTransfer(baseRequest, { ...baseObserved, tokenContract: '0x4444444444444444444444444444444444444444' }), /TOKEN_CONTRACT_MISMATCH/);
});

test('rejects wrong destination', () => {
  assert.throws(() => verifyOnChainTransfer(baseRequest, { ...baseObserved, to: '0x5555555555555555555555555555555555555555' }), /DESTINATION_MISMATCH/);
});

test('rejects wrong amount', () => {
  assert.throws(() => verifyOnChainTransfer(baseRequest, { ...baseObserved, amountUsdt: '24.00000000' }), /AMOUNT_MISMATCH/);
});

test('rejects insufficient confirmations', () => {
  assert.throws(() => verifyOnChainTransfer(baseRequest, { ...baseObserved, confirmations: 11 }), /INSUFFICIENT_CONFIRMATIONS/);
});

test('rejects malformed transaction hash', () => {
  assert.throws(() => verifyOnChainTransfer(baseRequest, { ...baseObserved, txHash: 'not-a-tx-hash' }), /INVALID_TX_HASH/);
});
