import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { setTimeout as wait } from 'timers/promises';

const PREVIEW_PORT = process.env.PORT || '4173';
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

function startPreview() {
  const child = spawn('npm', ['run', 'preview', '--', '--host', '--port', PREVIEW_PORT], {
    stdio: 'pipe',
    env: process.env,
  });

  child.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(text);
  });
  child.stderr.on('data', (data) => {
    const text = data.toString();
    process.stderr.write(text);
  });

  return child;
}

async function main() {
  const preview = startPreview();
  let previewExited = false;
  preview.on('exit', (code) => {
    previewExited = true;
    if (code !== 0) {
      console.error(`Preview server exited with code ${code}`);
    }
  });

  // Allow preview server to come up
  await wait(4000);
  if (previewExited) {
    throw new Error('Preview server exited early.');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const smartTrimLogs = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[smart-trim]')) {
      smartTrimLogs.push(text);
    }
  });

  try {
    await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded' });

    // Open Studio modal
    await page.getByRole('button', { name: /Open Studio/i }).click();

    // Upload two images to pass step 0
    await page.waitForSelector('#studio-image-input', { state: 'attached', timeout: 10000 });
    const imageInput = page.locator('#studio-image-input');
    await imageInput.setInputFiles([
      'testing-assets/mgcmale1.png',
      'testing-assets/mgcmal1.2.png',
    ]);

    await page.getByRole('button', { name: /Continue/i }).click();

    // Upload audio on step 1
    const audioInput = page.locator('input[type="file"][accept*="audio"]');
    await audioInput.setInputFiles('testing-assets/Supernatural-MGC 3.mp3');

    // Wait for smart trim to run and surface status
    await page.waitForFunction(() => {
      const nodes = Array.from(document.querySelectorAll('div, span, p'));
      return nodes.some((n) => /Smart trim:/.test(n.textContent || ''));
    }, { timeout: 10000 });

    if (smartTrimLogs.length === 0) {
      throw new Error('Expected a [smart-trim] console log, but none were captured.');
    }

    console.log('✅ Smart trim executed and status surfaced.');
    console.log('Captured smart-trim logs:', smartTrimLogs);
  } finally {
    await browser.close();
    preview.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
