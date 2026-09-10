import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const read=file=>fs.readFileSync(new URL(`./${file}`,import.meta.url),'utf8');
for(const file of ['index.html','styles.css','app.js'])
  assert.ok(fs.existsSync(new URL(`./${file}`,import.meta.url)),`${file} is missing`);

const html=read('index.html');
const js=read('app.js');
const css=read('styles.css');

for(const marker of [
  'id="masters"','id="queueBadge"','id="demoBtn"','id="real"',
  'id="authBtn"','id="authModal"','id="authSubmit"','styles.css?v=3','app.js?v=3'
]) assert.ok(html.includes(marker),`index.html missing ${marker}`);

for(const marker of [
  'MAX_FOLLOWERS=2','followers:0','queue:0','followers<MAX_FOLLOWERS',
  'joined.has(id)','queued.has(id)','m.queue++','Demo Exchange',
  'هیچ سفارش واقعی','ct_demo_account_v3','localStorage','loadDemoAccount',
  'saveDemoAccount','showToast','setAuthError'
]) assert.ok(js.includes(marker),`app.js missing required behavior: ${marker}`);

assert.ok((js.match(/followers:0/g)||[]).length>=3,'demo masters must start empty');
assert.ok(js.includes('password.length<4'),'demo password validation missing');
assert.ok(!js.includes('JSON.stringify({username,password}'),'demo password must never be stored');

for(const marker of ['@media','.master','.dashboard','.modal','.login-btn','.toast','.form-error'])
  assert.ok(css.includes(marker),`styles.css missing ${marker}`);

execFileSync(process.execPath,['--check',new URL('./app.js',import.meta.url).pathname],{stdio:'pipe'});
console.log('SITE SMOKE TEST: PASS');
