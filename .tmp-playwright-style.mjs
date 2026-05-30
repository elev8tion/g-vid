import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Start a new clip' }).click();
await page.waitForTimeout(500);
const headerStyles = await page.$eval('.fixed.inset-0 .h-14', el => {
  const cs = getComputedStyle(el);
  return { opacity: cs.opacity, color: cs.color, display: cs.display, position: cs.position, height: cs.height };
});
console.log(headerStyles);
await browser.close();
