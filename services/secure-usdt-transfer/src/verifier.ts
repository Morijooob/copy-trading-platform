export type OnChainTransfer = {
  chainId: number;
  tokenContract: string;
  from: string;
  to: string;
  amountUsdt: string;
  confirmations: number;
  txHash: string;
};

export type VerificationRequest = {
  network: string;
  destination: string;
  amountUsdt: string;
  expectedChainId: number;
  expectedUsdtContract: string;
  minConfirmations: number;
};

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function verifyOnChainTransfer(
  request: VerificationRequest,
  observed: OnChainTransfer,
): void {
  if (request.network.toUpperCase() !== 'BEP20') throw new Error('NETWORK_NOT_ALLOWED');
  if (!ADDRESS_RE.test(request.destination)) throw new Error('INVALID_BSC_DESTINATION');
  if (!TX_HASH_RE.test(observed.txHash)) throw new Error('INVALID_TX_HASH');
  if (observed.chainId !== request.expectedChainId) throw new Error('CHAIN_ID_MISMATCH');
  if (observed.tokenContract.toLowerCase() !== request.expectedUsdtContract.toLowerCase()) {
    throw new Error('TOKEN_CONTRACT_MISMATCH');
  }
  if (observed.to.toLowerCase() !== request.destination.toLowerCase()) {
    throw new Error('DESTINATION_MISMATCH');
  }
  if (observed.amountUsdt !== request.amountUsdt) throw new Error('AMOUNT_MISMATCH');
  if (!Number.isInteger(observed.confirmations) || observed.confirmations < request.minConfirmations) {
    throw new Error('INSUFFICIENT_CONFIRMATIONS');
  }
}
