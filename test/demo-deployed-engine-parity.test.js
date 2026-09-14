import assert from 'node:assert/strict';
import { DemoTradingEngine as CanonicalEngine, signalFromRows as canonicalSignal } from '../src/demo/demo-trading-engine.js';
import { DemoTradingEngine as DeployedEngine, signalFromRows as deployedSignal } from '../site/src/demo/demo-trading-engine.js';

function market(price, baseline = 100, recentVolume = 2, baseVolume = 1) {
  const prices = Array.from({ length: 20 }, () => baseline);
  prices.push(price, price);
  const volumes = Array.from({ length: 20 }, () => baseVolume);
  volumes.push(recentVolume, recentVolume);
  return prices.map((p, i) => [i, 0, 0, 0, p, volumes[i]]);
}

for (const price of [99.6, 100, 100.4, 101, 102]) {
  const rows = market(price);
  assert.deepEqual(deployedSignal(rows), canonicalSignal(rows));

  const canonical = new CanonicalEngine({ capital: 1000, config: { minScore: 20 } });
  const deployed = new DeployedEngine({ capital: 1000, config: { minScore: 20 } });
  assert.deepEqual(deployed.process({ ETHUSDT: rows }), canonical.process({ ETHUSDT: rows }));
  assert.deepEqual(deployed.snapshot(), canonical.snapshot());
}

console.log('deployed demo engine parity: ok');
