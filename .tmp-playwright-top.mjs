import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Start a new clip' }).click();
await page.waitForTimeout(500);
const top = await page.$eval('.fixed.inset-0', el => {
  const cs = getComputedStyle(el);
  return { top: cs.top, right: cs.right, bottom: cs.bottom, left: cs.left, position: cs.position };
});
console.log(top);
await browser.close();
