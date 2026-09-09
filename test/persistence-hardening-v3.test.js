import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonPersistenceStore } from '../src/persistence-store-v2.js';

test('persistence module exports the expected API', () => {
  assert.equal(typeof JsonPersistenceStore, 'function');
  assert.equal(typeof JsonPersistenceStore.prototype.load, 'function');
  assert.equal(typeof JsonPersistenceStore.prototype.save, 'function');
});
