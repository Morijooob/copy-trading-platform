import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonPersistenceStore } from '../src/persistence-store-v2.js';

test('JSON persistence survives a new store instance', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-persistence-'));
  const filePath = path.join(dir, 'state.json');
  try {
    const first = new JsonPersistenceStore({ filePath });
    await first.save({ users: [{ id: 'u1' }], subscriptions: [{ id: 's1' }] });
    const second = new JsonPersistenceStore({ filePath });
    assert.deepEqual(await second.load(), {
      users: [{ id: 'u1' }],
      subscriptions: [{ id: 's1' }]
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('JSON persistence writes atomically and serializes concurrent saves', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-persistence-'));
  const filePath = path.join(dir, 'state.json');
  try {
    const store = new JsonPersistenceStore({ filePath });
    await Promise.all([
      store.save({ version: 1 }),
      store.save({ version: 2 }),
      store.save({ version: 3 })
    ]);
    const loaded = await store.load();
    assert.deepEqual(loaded, { version: 3 });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('missing JSON persistence file returns the supplied default', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-persistence-'));
  try {
    const store = new JsonPersistenceStore({ filePath: path.join(dir, 'missing.json') });
    assert.deepEqual(await store.load({ users: [], subscriptions: [] }), { users: [], subscriptions: [] });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
