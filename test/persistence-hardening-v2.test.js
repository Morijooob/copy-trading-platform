import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonPersistenceStore } from '../src/persistence-store-v2.js';

test('persistence survives a new store instance', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-persistence-'));
  const filePath = path.join(dir, 'state.json');
  try {
    const first = new JsonPersistenceStore({ filePath });
    await first.save({ users: [{ id: 'u1' }], subscriptions: [{ id: 's1' }] });
    const second = new JsonPersistenceStore({ filePath });
    assert.deepEqual(await second.load(), { users: [{ id: 'u1' }], subscriptions: [{ id: 's1' }] });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('concurrent saves are serialized', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-persistence-'));
  const filePath = path.join(dir, 'state.json');
  try {
    const store = new JsonPersistenceStore({ filePath });
    await Promise.all([store.save({ version: 1 }), store.save({ version: 2 }), store.save({ version: 3 })]);
    assert.deepEqual(await store.load(), { version: 3 });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('missing persistence file returns default', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-persistence-'));
  try {
    const store = new JsonPersistenceStore({ filePath: path.join(dir, 'missing.json') });
    assert.deepEqual(await store.load({ users: [], subscriptions: [] }), { users: [], subscriptions: [] });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
