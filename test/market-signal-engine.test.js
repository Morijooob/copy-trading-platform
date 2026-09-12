import assert from 'node:assert/strict';
import { computeMarketSignal, nextPositionAction } from '../src/market-signal-engine.js';

const up = Array.from({ length: 60 }, (_, i) => 100 + i * 1.2);
const down = Array.from({ length: 60 }, (_, i) => 200 - i * 1.2);
const volume = Array.from({ length: 60 }, () => 100);

const buy = computeMarketSignal({ closes: up, volumes: volume });
assert.equal(buy.side, 'BUY');
assert.equal(nextPositionAction({ side: 'BUY', position: 'FLAT', score: buy.score }).action, 'OPEN_LONG');

const sell = computeMarketSignal({ closes: down, volumes: volume });
assert.equal(sell.side, 'SELL');
assert.equal(nextPositionAction({ side: 'SELL', position: 'FLAT', score: sell.score }).action, 'OPEN_SHORT');
assert.equal(nextPositionAction({ side: 'SELL', position: 'LONG', score: sell.score }).action, 'CLOSE_LONG_THEN_SHORT');
assert.equal(nextPositionAction({ side: 'BUY', position: 'SHORT', score: buy.score }).action, 'CLOSE_SHORT_THEN_LONG');
assert.equal(nextPositionAction({ side: 'BUY', position: 'FLAT', score: 19 }).action, 'NO_TRADE');

console.log('market-signal-engine tests: PASS');
