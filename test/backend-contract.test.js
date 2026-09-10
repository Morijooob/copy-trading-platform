import assert from 'node:assert/strict';
import fs from 'node:fs';

const health = fs.readFileSync(new URL('../api/health.js', import.meta.url), 'utf8');
const status = fs.readFileSync(new URL('../api/real-status.js', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../supabase/migrations/001_production_schema.sql', import.meta.url), 'utf8');

assert.match(health, /realTradingEnabled: false/);
assert.match(status, /readyForRealMoney: false/);
assert.match(status, /DATABASE_URL/);
assert.match(status, /EXIR_API_KEY/);
assert.match(schema, /create table if not exists users/);
assert.match(schema, /create table if not exists exchange_accounts/);
assert.match(schema, /create table if not exists orders/);
assert.match(schema, /create table if not exists ledger_entries/);
assert.match(schema, /create table if not exists audit_events/);
console.log('BACKEND CONTRACT: ALL TESTS PASSED');
