import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Masterها' }).click();
  await page.waitForSelector('#masters .master');
  if (await page.locator('#masters .master').count() < 3) throw new Error('expected at least 3 masters');

  await page.locator('#masters .master').first().getByRole('button', { name: /Copy این Master/ }).click();
  await page.getByRole('button', { name: 'تأیید و شروع' }).click();
  await page.waitForSelector('#dash.active');
  await page.getByRole('button', { name: 'Masterهای من' }).click();
  await page.waitForSelector('#following');
  if (!(await page.locator('#following').innerText()).includes('Alpha Master')) throw new Error('copy subscription not visible');

  await page.getByRole('button', { name: 'نمای کلی' }).click();
  if (!(await page.locator('#overview').innerText()).includes('داشبورد')) throw new Error('dashboard did not render');
} finally {
  await browser.close();
}

console.log('web browser E2E smoke: PASS');
