const SCALE = 100000000n;

function parseFixed(value, label) {
  const text = String(value ?? '').trim();
  if (!/^[+-]?(?:\d+)(?:\.\d{1,8})?$/.test(text)) throw new Error(`${label} must be a decimal with up to 8 places`);
  const negative = text.startsWith('-');
  const unsigned = text.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  const scaled = BigInt(whole) * SCALE + BigInt((fraction + '00000000').slice(0, 8));
  return negative ? -scaled : scaled;
}

function formatFixed(value) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const fraction = String(abs % SCALE).padStart(8, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function mulFixed(a, b) {
  return (a * b) / SCALE;
}

function roundDiv(numerator, denominator) {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator < 0n ? -numerator : numerator;
  return sign * ((abs + denominator / 2n) / denominator);
}

export class TradePnlEngine {
  constructor({ feeRateBps = 0 } = {}) {
    if (!Number.isInteger(feeRateBps) || feeRateBps < 0 || feeRateBps > 10000) {
      throw new Error('fee rate must be 0..10000 bps');
    }
    this.feeRateBps = BigInt(feeRateBps);
  }

  calculate({ side, quantity, entryPrice, exitPrice, entryFee = '0', exitFee = '0' } = {}) {
    const normalizedSide = String(side || '').toLowerCase();
    if (!['buy', 'sell', 'long', 'short'].includes(normalizedSide)) throw new Error('side must be buy/sell or long/short');
    const isLong = normalizedSide === 'buy' || normalizedSide === 'long';
    const qty = parseFixed(quantity, 'quantity');
    const entry = parseFixed(entryPrice, 'entryPrice');
    const exit = parseFixed(exitPrice, 'exitPrice');
    if (qty <= 0n || entry <= 0n || exit <= 0n) throw new Error('quantity and prices must be positive');

    const entryNotional = mulFixed(qty, entry);
    const exitNotional = mulFixed(qty, exit);
    const gross = isLong ? exitNotional - entryNotional : entryNotional - exitNotional;
    const actualEntryFee = parseFixed(entryFee, 'entryFee');
    const actualExitFee = parseFixed(exitFee, 'exitFee');
    if (actualEntryFee < 0n || actualExitFee < 0n) throw new Error('fees cannot be negative');
    const fees = actualEntryFee + actualExitFee;
    const net = gross - fees;
    const returnOnCapital = entryNotional === 0n ? 0n : roundDiv(net * SCALE, entryNotional);

    return {
      side: isLong ? 'long' : 'short',
      quantity: formatFixed(qty),
      entryPrice: formatFixed(entry),
      exitPrice: formatFixed(exit),
      entryNotional: formatFixed(entryNotional),
      exitNotional: formatFixed(exitNotional),
      grossPnl: formatFixed(gross),
      entryFee: formatFixed(actualEntryFee),
      exitFee: formatFixed(actualExitFee),
      totalFees: formatFixed(fees),
      netPnl: formatFixed(net),
      returnOnCapital: formatFixed(returnOnCapital)
    };
  }

  estimateFees(notional) {
    const value = parseFixed(notional, 'notional');
    if (value < 0n) throw new Error('notional cannot be negative');
    return formatFixed(roundDiv(value * this.feeRateBps, 10000n));
  }
}
