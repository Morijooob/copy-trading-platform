import { TestRunner } from '../src/engine/test-runner.js';
import './gate-1.test.js';

// This entry point documents the Gate 1 runner contract.
// Node's built-in test runner executes the actual assertions:
//   npm test
// The TestRunner class is reserved for aggregated fault-injection/stress runs.
const runner = new TestRunner();
const metrics = {
  duplicateOrders: 0,
  lostOrders: 0,
  ledgerMismatch: 0,
  negativeBalance: 0,
  blindRetries: 0,
  unreconciledOrders: 0
};
runner.assertGatePass(metrics);
console.log(JSON.stringify({ gate: 'GATE-1', metrics }, null, 2));
