// Scripted walk-through of the manual UI steps (records what the checker page shows for each TC).
// Needs playwright: npx playwright ... or PW=/path/to/playwright. Usage: node scripts/ui-walkthrough.js docs/screenshots
const { chromium } = require(process.env.PW || 'playwright');
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  // screenshots only: hide the custom cursor and pin the nav so it doesn't float over content
  const shot = async (path) => {
    await page.addStyleTag({ content: '.cd,.cr{display:none!important}.nav{position:absolute!important}' });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path, fullPage: true });
  };
  const read = async () => page.evaluate(() => ({
    status: document.querySelector('#status').textContent,
    rows: [...document.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent.trim()).join(' | ')),
    warnings: [...document.querySelectorAll('.list.w li')].map((l) => l.textContent),
    errors: [...document.querySelectorAll('.list.e li')].map((l) => l.textContent),
    message: document.querySelector('.err, .empty')?.textContent || '',
  }));

  // home page -> nav link
  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(1700); // curtain animation
  await page.screenshot({ path: `${out}/00-home-nav.png`, clip: { x: 0, y: 0, width: 1360, height: 120 } });
  await page.click('nav >> text=Contribution checker');
  await page.waitForLoadState();
  console.log('nav link ->', page.url());

  // sample data
  await page.click('#sample');
  await page.click('#go');
  await page.waitForSelector('tbody tr');
  console.log('SAMPLE', JSON.stringify(await read()));
  await shot(`${out}/01-sample-data.png`);

  for (let i = 1; i <= 14; i++) {
    const id = 'TC-' + String(i).padStart(2, '0');
    await page.selectOption('#tc', id);
    await page.waitForTimeout(250);
    if (id === 'TC-14') await page.click('#health');
    else await page.click('#go');
    await page.waitForFunction((prev) => document.querySelector('#status').textContent !== 'No request yet', null);
    await page.waitForTimeout(250);
    const r = await read();
    console.log(id, JSON.stringify(r));
    await shot(`${out}/${id}.png`);
  }

  // escaping check: author with HTML in it must render as text
  await page.fill('#body', JSON.stringify({ commits: [{ sha: 'x1', author: '<img src=x onerror="window.hacked=1">', additions: 1, deletions: 0, date: '2026-03-02T10:00:00Z', message: 'm' }] }));
  await page.click('#go');
  await page.waitForTimeout(400);
  console.log('XSS check: hacked =', await page.evaluate(() => window.hacked === 1), '| cell text =', await page.textContent('tbody td'));

  // narrow screen
  await page.setViewportSize({ width: 390, height: 900 });
  await page.selectOption('#tc', 'TC-04'); await page.waitForTimeout(250); await page.click('#go'); await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  console.log('phone width horizontal overflow:', overflow);
  await page.screenshot({ path: `${out}/phone-TC-04.png`, fullPage: true });

  // dark mode
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.selectOption('#tc', 'TC-02'); await page.waitForTimeout(250); await page.click('#go'); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/dark-TC-02.png` });

  console.log('console errors:', JSON.stringify(consoleErrors));
  await browser.close();
})();
