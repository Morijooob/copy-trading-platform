import fs from 'node:fs';
import assert from 'node:assert/strict';
const required=['index.html','styles.css','app.js','supabase-config.js','demo.html','demo-v2.html'];
for(const file of required){const path=new URL(`./${file}`,import.meta.url);assert.ok(fs.existsSync(path),`${file} is missing`);const text=fs.readFileSync(path,'utf8');assert.ok(text.length>100,`${file} is unexpectedly empty`);}
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
assert.ok(html.includes('Copy Trading Platform'),'site title missing');
assert.ok(html.includes('id="masters"'),'masters section missing');
assert.ok(js.includes('APP_VERSION'),'app version marker missing');
console.log('SITE SMOKE TEST: PASS');
