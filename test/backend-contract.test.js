import assert from 'node:assert/strict';
import fs from 'node:fs';

const health = fs.readFileSync(new URL('../api/health.js', import.meta.url), 'utf8');
const status = fs.readFileSync(new URL('../api/real-status.js', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../supabase/migrations/001_production_schema.sql', import.meta.url), 'utf8');

assert.match(health, /realTradingEnabled: false/);
assert.match(status, /readyForRealMoney: false/);
assert.match(status, /DATABASE_URL/);
assert.match(status, /EXIR_API_KEY/);

// Supabase Auth owns identities in auth.users; public application data is in public.* tables.
assert.match(schema, /create table if not exists public\.profiles/);
assert.match(schema, /references auth\.users\(id\)/);
assert.match(schema, /create table if not exists public\.masters/);
assert.match(schema, /create table if not exists public\.follows/);
assert.match(schema, /create table if not exists public\.trades/);
assert.match(schema, /create table if not exists public\.follower_trades/);
assert.match(schema, /create table if not exists public\.ledger_entries/);
assert.match(schema, /create table if not exists public\.audit_log/);
assert.match(schema, /join_master\(p_user_id uuid,p_master_id uuid\)/);
console.log('BACKEND CONTRACT: ALL TESTS PASSED');
