export class TestRunner {
  constructor() {
    this.results = [];
  }

  async run(name, testFn) {
    const startedAt = Date.now();
    try {
      await testFn();
      this.results.push({ name, status: 'PASS', durationMs: Date.now() - startedAt });
    } catch (error) {
      this.results.push({ name, status: 'FAIL', durationMs: Date.now() - startedAt, error: error.message });
    }
  }

  summary() {
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.length - passed;
    return { total: this.results.length, passed, failed, results: [...this.results] };
  }

  assertGatePass(metrics) {
    const critical = ['duplicateOrders', 'lostOrders', 'ledgerMismatch', 'negativeBalance', 'blindRetries', 'unreconciledOrders'];
    const failures = critical.filter(key => metrics[key] !== 0);
    if (failures.length) throw new Error(`Gate 1 failed: ${failures.join(', ')}`);
    return true;
  }
}
