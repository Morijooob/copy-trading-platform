import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

test('web UI exposes real auth flow', () => {
  assert.match(html, /id="authModal"/);
  assert.match(html, /\/api\/auth\/register/);
  assert.match(html, /\/api\/auth\/login/);
  assert.match(html, /localStorage\.setItem\('copyToken'/);
});

test('web UI exposes demo-to-dashboard copy flow', () => {
  assert.match(html, /\/api\/session/);
  assert.match(html, /\/api\/masters/);
  assert.match(html, /\/api\/copy/);
  assert.match(html, /\/api\/dashboard/);
  assert.match(html, /stopCopy/);
});

test('copy configuration is constrained to demo mode in current UI', () => {
  assert.match(html, /<option value="DEMO">DEMO/);
  assert.doesNotMatch(html, /<option value="LIVE">/);
});
