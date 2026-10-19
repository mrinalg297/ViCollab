// Walks through the app screens in Chromium (Playwright), checks the main flows and saves
// screenshots for docs/UI_DESIGN.md. Start the server first (npm start).
// Usage: node scripts/ui-design-walkthrough.js docs/ui-screens
const fs = require('fs');
const { chromium } = require(process.env.PW || 'playwright');
const out = process.argv[2] || 'docs/ui-screens';
const BASE = 'http://localhost:3000/app/';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
  const log = (...a) => console.log(...a);
  const shot = async (name, full = true) => {
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); scrollTo(0, 0); });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    return page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  };
  const text = (sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '(none)');

  // 1. not linked
  await page.goto(BASE + 'dashboard.html');
  await page.waitForSelector('.state');
  log('dashboard, not linked:', await text('.state h2'));
  await shot('01-dashboard-not-linked', false);

  // 2. connect with mock OAuth
  await page.goto(BASE + 'connect.html');
  await shot('02-connect-before');
  await page.click('#connect');
  await page.waitForSelector('dialog[open]');
  await shot('03-oauth-dialog', false);
  await page.click('#authorize');
  await page.waitForSelector('.toast');
  log('toast after connect:', await text('.toast'));
  log('badge:', await text('#gh-badge'));

  // 3. sync with spinner, then success toast
  await page.click('#sync');
  await page.waitForSelector('#sync .spin');
  log('sync button while syncing:', await text('#sync'), '| disabled =', await page.$eval('#sync', (b) => b.disabled));
  await shot('04-syncing', false);
  await page.waitForSelector('#sync-msg .banner.ok', { timeout: 5000 });
  log('after sync:', await text('#sync-msg'), '| last synced:', await text('#synced'), '| found:', await text('#found'));
  await shot('05-connect-synced');

  // 4. dashboard, all 12 weeks
  await page.goto(BASE + 'dashboard.html');
  await page.waitForSelector('#bars');
  log('stats:', await text('.g4'));
  log('table rows:', await page.$$eval('tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim())));
  log('warnings:', await text('#warnings'));
  await shot('06-dashboard-all');

  // 5. sprint 1 preset: Kabir above 60%
  await page.click('.chip:has-text("Sprint 1")');
  await page.waitForSelector('.banner.warn');
  log('sprint 1 warning:', await text('.banner.warn'));
  await shot('07-dashboard-sprint1-warning');

  // 6. last 4 weeks: Kabir 0 commits
  await page.click('.chip:has-text("Last 4 weeks")');
  await page.waitForFunction(() => document.querySelector('#warnings').innerText.includes('No commits in this range'));
  log('last 4 weeks info:', await text('.banner.info'));

  // 7. search + sort
  await page.click('.chip:has-text("All 12 weeks")');
  await page.waitForSelector('#bars');
  await page.fill('#search', 'me');
  log('search "me":', await text('#count'), await page.$$eval('tbody tr b', (r) => r.map((x) => x.textContent)));
  await page.fill('#search', 'zzz');
  log('search "zzz":', await text('#count'), '|', await text('tbody'));
  await page.fill('#search', '');
  await page.dispatchEvent('#search', 'input');
  await page.click('[data-sort="commits"]');
  log('sorted by commits:', await page.$$eval('tbody tr b', (r) => r.map((x) => x.textContent)), await page.$eval('th[aria-sort]', (t) => t.innerText + ' ' + t.getAttribute('aria-sort')));
  await page.click('[data-sort="commits"]');
  log('sorted again:', await page.$$eval('tbody tr b', (r) => r.map((x) => x.textContent)), await page.$eval('th[aria-sort]', (t) => t.getAttribute('aria-sort')));
  await page.click('[data-sort="score"]');

  // 8. export CSV
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const csvPath = `${out}/export-sample.csv`;
  await dl.saveAs(csvPath);
  log('csv file:', dl.suggestedFilename());
  log(fs.readFileSync(csvPath, 'utf8').trim());

  // 9. tooltip on a bar (keyboard focus)
  await page.focus('.fill');
  log('bar tooltip on focus:', await text('.tip.on'));

  // 10. member detail pages
  await page.goto(BASE + 'member.html?m=kabir-s&since=2026-07-27&until=2026-10-18');
  await page.waitForSelector('#weekly svg');
  log('kabir head:', await text('#head'));
  log('kabir stats:', await text('.g4'));
  await page.focus('#weekly .hit');
  log('week tooltip:', await text('#weekly .tip'));
  await shot('08-member-kabir');
  await page.goto(BASE + 'member.html?m=aarav-m&since=2026-07-27&until=2026-10-18');
  await page.waitForSelector('#weekly svg');
  log('aarav commits shown:', await page.$$eval('.commits li', (l) => l.length), '| button:', await text('#more'));
  await page.click('#more');
  await page.waitForFunction(() => document.querySelectorAll('.commits li').length > 8);
  log('after show all:', await page.$$eval('.commits li', (l) => l.length), '| focused:', await page.evaluate(() => document.activeElement.className || document.activeElement.tagName));
  await page.goto(BASE + 'member.html?m=aarav-m&since=2026-07-27&until=2026-10-18');
  await page.waitForSelector('#weekly svg');
  await shot('09-member-aarav');
  await page.goto(BASE + 'member.html?m=kabir-s&since=2026-09-21&until=2026-10-18');
  await page.waitForSelector('.state');
  log('kabir last 4 weeks:', await text('.state'));

  // 11. empty and error states, live
  await page.goto(BASE + 'dashboard.html?since=2026-10-18&until=2026-07-27');
  await page.waitForSelector('.state');
  log('invalid range:', await text('.state'), '| aria-invalid:', await page.$eval('#since', (i) => i.getAttribute('aria-invalid')));
  await shot('10-state-invalid-range', false);
  await page.click('.state .btn');
  await page.waitForSelector('#bars');
  log('after reset:', await page.$eval('#since', (i) => i.value), await page.$eval('#until', (i) => i.value));

  await page.goto(BASE + 'dashboard.html?since=2026-10-19&until=2026-10-25');
  await page.waitForSelector('.state');
  log('no commits:', await text('.state h2'));
  await shot('11-state-no-commits', false);

  await page.goto(BASE + 'connect.html');
  await page.click('summary');
  await page.check('#fail');
  await page.click('#sync');
  await page.waitForSelector('#sync-msg .banner.err', { timeout: 5000 });
  log('sync failed toast:', await text('.toast.err'), '| panel:', await text('#sync-msg'), '| badge:', await text('#gh-badge'));
  await shot('12-state-sync-failed');
  await page.goto(BASE + 'dashboard.html');
  await page.waitForSelector('#bars');
  log('dashboard after failed resync:', await text('#sync-banner'));
  await page.click('#retry-sync');
  await page.waitForSelector('.toast.ok', { timeout: 5000 });
  log('retry:', await text('.toast.ok'), '| banner now:', await text('#sync-banner'));

  await page.goto(BASE + 'connect.html');
  await page.selectOption('#repo', 'mrinalg297/sandbox');
  await page.click('#sync');
  await page.waitForSelector('#sync-msg .banner.ok', { timeout: 5000 });
  await page.goto(BASE + 'dashboard.html');
  await page.waitForSelector('.state');
  log('empty repo:', await text('.state h2'));
  await page.goto(BASE + 'connect.html');
  await page.selectOption('#repo', 'mrinalg297/vicollab');
  await page.click('#sync');
  await page.waitForSelector('#sync-msg .banner.ok', { timeout: 5000 });

  await page.goto(BASE + 'states.html');
  await shot('13-states-gallery');

  // 12. keyboard: first Tab goes to the skip link, Enter moves focus to main
  await page.goto(BASE + 'dashboard.html');
  await page.waitForSelector('#bars');
  await page.keyboard.press('Tab');
  log('first tab stop:', await page.evaluate(() => document.activeElement.textContent));
  await page.keyboard.press('Enter');
  log('after Enter:', await page.evaluate(() => document.activeElement.id));
  const order = [];
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => { const a = document.activeElement; return (a.getAttribute('aria-label') || a.textContent || a.id || a.tagName).trim().slice(0, 30); })); }
  log('tab order inside main:', order.join(' → '));

  // 13. phone width + drawer
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + 'dashboard.html');
  await page.waitForSelector('#bars');
  log('phone overflow:', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await shot('14-phone-dashboard');
  await page.click('#menu');
  await page.waitForTimeout(300);
  log('drawer open, aria-expanded =', await page.$eval('#menu', (b) => b.getAttribute('aria-expanded')), '| focus on:', await page.evaluate(() => document.activeElement.textContent));
  await shot('15-phone-drawer', false);
  await page.keyboard.press('Escape');
  log('after Esc, aria-expanded =', await page.$eval('#menu', (b) => b.getAttribute('aria-expanded')));
  await page.goto(BASE + 'member.html?m=meera-iyer');
  await page.waitForSelector('#weekly svg');
  log('phone member overflow:', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await shot('16-phone-member');
  await page.goto(BASE + 'connect.html');
  log('phone connect overflow:', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));

  // 14. dark mode via the toggle
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(BASE + 'dashboard.html');
  await page.waitForSelector('#bars');
  await page.click('#theme');
  log('theme after toggle:', await page.evaluate(() => document.documentElement.dataset.theme));
  await page.click('.chip:has-text("Sprint 1")');
  await page.waitForSelector('.banner.warn');
  await shot('17-dark-dashboard');
  await page.goto(BASE + 'member.html?m=isha-rao&since=2026-07-27&until=2026-10-18');
  await page.waitForSelector('#weekly svg');
  await shot('18-dark-member');
  await page.click('#theme'); // back to light for next run

  log('problems:', problems);
  await browser.close();
})();
