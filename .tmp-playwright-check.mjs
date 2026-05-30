import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Start a new clip' }).click();
await page.waitForTimeout(500);
const style = await page.$eval('[aria-label="Close studio"]', (el) => {
  const root = el.closest('.fixed.inset-0');
  if (!root) return { exists: false };
  const cs = getComputedStyle(root);
  return {
    exists: true,
    styles: {
      position: cs.position,
      zIndex: cs.zIndex,
      opacity: cs.opacity,
      display: cs.display,
      background: cs.backgroundColor,
    },
  };
});
console.log(style);
await browser.close();
