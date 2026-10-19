// Accessibility audit of the app screens with axe-core (WCAG 2.1 A/AA + best practice), light and dark mode.
// Needs the server running and axe-core: npm i --no-save axe-core, then
// node scripts/ui-a11y-audit.js node_modules/axe-core/axe.min.js
const { chromium } = require(process.env.PW || 'playwright');
const axe = require('fs').readFileSync(process.argv[2], 'utf8');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const B = 'http://localhost:3000/app/';
  // put the app in the synced state first
  await p.goto(B + 'connect.html');
  await p.evaluate(() => localStorage.setItem('vicollab.github', JSON.stringify({ connected: true, login: 'mrinalg297', repo: 'mrinalg297/vicollab', syncedRepo: 'mrinalg297/vicollab', lastSynced: new Date().toISOString() })));
  const pages = ['connect.html', 'dashboard.html', 'dashboard.html?since=2026-07-27&until=2026-08-09', 'dashboard.html?since=2026-10-18&until=2026-07-27', 'member.html?m=kabir-s&since=2026-07-27&until=2026-10-18', 'states.html'];
  for (const theme of ['light', 'dark']) {
    await p.emulateMedia({ colorScheme: theme });
    for (const u of pages) {
      await p.goto(B + u); await p.waitForTimeout(900);
      await p.addScriptTag({ content: axe });
      const r = await p.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
      console.log(theme, u, '-> violations:', r.violations.length, r.violations.map(v => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0,2).map(n=>n.target.join(' ')+' '+(n.any[0]?.message||'')).join(' | ')}`).join('\n    '));
    }
  }
  await b.close();
})();
