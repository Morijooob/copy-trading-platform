import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const phone = `+98912${Date.now().toString().slice(-7)}`;
const password = 'BrowserE2E!2026';

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'ورود / ثبت‌نام' }).click();
  await page.locator('#registerTab').click();
  await page.locator('#authName').fill('Browser E2E');
  await page.locator('#authPhone').fill(phone);
  await page.locator('#authPassword').fill(password);
  const registerResponse = page.waitForResponse(r => r.url().endsWith('/api/auth/register') && r.request().method() === 'POST');
  await page.locator('#authSubmit').click();
  const registration = await registerResponse;
  if (!registration.ok()) throw new Error(`registration failed: ${await registration.text()}`);

  await page.locator('#authPassword').fill(password);
  await page.locator('#authSubmit').click();
  await page.waitForSelector('#dash.active');

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
