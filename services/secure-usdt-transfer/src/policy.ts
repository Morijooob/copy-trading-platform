export type TransferRequest = {
  id: string;
  amountUsdt: string;
  destination: string;
  network: string;
  status: 'pending' | 'locked' | 'processing' | 'completed' | 'rejected';
};

export type TransferPolicy = {
  enabled: boolean;
  chainId: number;
  usdtContract: string;
  maxTransferUsdt: string;
};

export function validateTransferPolicy(
  request: TransferRequest,
  policy: TransferPolicy,
): void {
  if (!policy.enabled) throw new Error('TRANSFER_EXECUTION_DISABLED');
  if (request.status !== 'locked') throw new Error('WITHDRAWAL_NOT_LOCKED');
  if (request.network.toUpperCase() !== 'BEP20') throw new Error('NETWORK_NOT_ALLOWED');
  if (!policy.usdtContract) throw new Error('USDT_CONTRACT_NOT_CONFIGURED');
  if (!request.destination || !/^0x[a-fA-F0-9]{40}$/.test(request.destination)) {
    throw new Error('INVALID_BSC_DESTINATION');
  }
  const amount = Number(request.amountUsdt);
  const max = Number(policy.maxTransferUsdt);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  if (!Number.isFinite(max) || max <= 0 || amount > max) throw new Error('TRANSFER_LIMIT_EXCEEDED');
}
