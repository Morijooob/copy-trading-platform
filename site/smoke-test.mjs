import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const read=file=>fs.readFileSync(new URL(`./${file}`,import.meta.url),'utf8');
for(const file of ['index.html','styles.css','app.js']) assert.ok(fs.existsSync(new URL(`./${file}`,import.meta.url)),`${file} is missing`);

const html=read('index.html');
const js=read('app.js');
const css=read('styles.css');

for(const marker of [
  'id="masters"','id="queueBadge"','id="demoBtn"','id="real"',
  'id="authBtn"','id="authModal"','id="authSubmit"',
  'id="loginTab"','id="registerTab"','id="email"','id="passwordConfirm"',
  'id="profileMenu"','id="topAvatar"','id="userAvatar"',
  'styles.css?v=8','app.js?v=9'
]) assert.ok(html.includes(marker),`index.html missing ${marker}`);

for(const marker of [
  'MAX_FOLLOWERS=2','followers:0','queue:0','followers<MAX_FOLLOWERS',
  'joined.has(id)','queued.has(id)','m.queue++','Demo Exchange',
  'هیچ سفارش واقعی','ct_demo_account_v6','ct_demo_session_v2','sessionStorage',
  'localStorage','loadDemoAccount','saveDemoAccount','restoreSession',
  'showToast','setAuthError','setAuthMode',"authMode==='register'",'passwordHash',
  'crypto.subtle.digest','emailVerified:false',
  'این مرورگر از قبل یک حساب دمو دارد','نام کاربری یا رمز عبور اشتباه است',
  'el.addEventListener(\'click\',activate)','keydown','tabIndex=0'
]) assert.ok(js.includes(marker),`app.js missing required behavior: ${marker}`);

assert.ok(js.includes('test(email)'),'email validation must be executed');
assert.ok((js.match(/followers:0/g)||[]).length>=3,'demo masters must start empty');
assert.ok(js.includes('password.length<4'),'demo password validation missing');
assert.ok(js.includes('passwordConfirm'),'registration password confirmation missing');
assert.ok(!js.includes('JSON.stringify({username,password}'),'demo password must never be stored');
assert.ok(!js.includes("localStorage.setItem(DEMO_KEY,JSON.stringify({username,password"),'plaintext password storage must not exist');

for(const marker of ['@media','.master','.dashboard','.modal','.login-btn','.toast','.form-error','.auth-tabs','.auth-tab','.avatar','.profile-menu']) assert.ok(css.includes(marker),`styles.css missing ${marker}`);

execFileSync(process.execPath,['--check',new URL('./app.js',import.meta.url).pathname],{stdio:'pipe'});
console.log('SITE SMOKE TEST: PASS');
