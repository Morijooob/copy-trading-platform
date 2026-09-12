import assert from 'node:assert/strict';
import { TradePnlEngine } from '../src/real/trade-pnl.js';

const pnl = new TradePnlEngine();

const longWin = pnl.calculate({
  side: 'buy', quantity: '1', entryPrice: '100', exitPrice: '102', entryFee: '0.1', exitFee: '0.102'
});
assert.equal(longWin.grossPnl, '2');
assert.equal(longWin.totalFees, '0.202');
assert.equal(longWin.netPnl, '1.798');

const shortWin = pnl.calculate({
  side: 'short', quantity: '2', entryPrice: '100', exitPrice: '98', entryFee: '0.2', exitFee: '0.196'
});
assert.equal(shortWin.grossPnl, '4');
assert.equal(shortWin.totalFees, '0.396');
assert.equal(shortWin.netPnl, '3.604');

const longLoss = pnl.calculate({
  side: 'long', quantity: '1', entryPrice: '100', exitPrice: '99', entryFee: '0.1', exitFee: '0.099'
});
assert.equal(longLoss.grossPnl, '-1');
assert.equal(longLoss.netPnl, '-1.199');

// Decimal arithmetic must not drift like binary floating point.
const exact = pnl.calculate({
  side: 'long', quantity: '0.12345678', entryPrice: '2541.92000000', exitPrice: '2542.20000000', entryFee: '0.00000001', exitFee: '0.00000002'
});
assert.equal(exact.grossPnl, '0.0345679');
assert.equal(exact.netPnl, '0.03456787');

const feePnl = new TradePnlEngine({ feeRateBps: 25 });
assert.equal(feePnl.estimateFees('100'), '0.25');
assert.equal(feePnl.estimateFees('102.02'), '0.25505');

assert.throws(() => pnl.calculate({ side: 'sideways', quantity: '1', entryPrice: '100', exitPrice: '101' }), /side/);
assert.throws(() => pnl.calculate({ side: 'long', quantity: '1', entryPrice: '100', exitPrice: '101', exitFee: '-0.1' }), /fees/);

console.log('real trade PnL exact arithmetic: ok');
