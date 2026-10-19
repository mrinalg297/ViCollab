// Checks for the app screens (Assessment: UI design): pages are served with the shared
// shell, and the mock GitHub data gives the states the screens rely on.
const request = require('supertest');
const app = require('../src/app');
const mock = require('../public/app/mock-data.js');
const { scoreContributions } = require('../src/scoring');

const logins = mock.members.map((m) => m.login);
const main = mock.repos.find((r) => r.fullName === 'mrinalg297/vicollab').commits;
const preset = (id) => mock.range.presets.find((p) => p.id === id);
const byLogin = (r) => Object.fromEntries(r.members.map((m) => [m.author, m]));

describe('UI pages', () => {
  test.each(['connect.html', 'dashboard.html', 'member.html', 'states.html'])('UI %s is served with the shared app shell', async (page) => {
    const res = await request(app).get('/app/' + page);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<main>');
    expect(res.text).toContain('src="app.js"');
    expect(res.text).toContain('href="app.css"');
    expect(res.text).toContain('src="mock-data.js"');
  });

  test('UI /app/ redirects to the dashboard', async () => {
    const res = await request(app).get('/app/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('dashboard.html');
  });

  test('UI shared script and styles are served', async () => {
    for (const f of ['app.js', 'app.css', 'mock-data.js']) {
      expect((await request(app).get('/app/' + f)).status).toBe(200);
    }
  });
});

describe('UI mock data', () => {
  test('UI main repo: 4 members, every commit valid, 3 merges and 1 duplicate', () => {
    const r = scoreContributions({ members: logins, commits: main });
    expect(mock.members).toHaveLength(4);
    expect(main).toHaveLength(225);
    expect(r.errors).toEqual([]);
    expect(r.skipped).toEqual({ duplicates: 1, merges: 3, outsideDateRange: 0 });
    expect(r.team.totalCommits).toBe(221);
    expect(r.warnings).toEqual([]); // whole project: nobody dominates
  });

  test('UI Sprint 1 preset shows Kabir above 60% (dashboard warning banner)', () => {
    const p = preset('sprint1');
    const r = scoreContributions({ members: logins, commits: main, since: p.since, until: p.until });
    expect(byLogin(r)['kabir-s'].score).toBeGreaterThan(60);
    expect(r.warnings).toEqual([expect.stringContaining('kabir-s has')]);
  });

  test('UI Last 4 weeks preset shows Kabir with 0 commits', () => {
    const p = preset('last4');
    const r = scoreContributions({ members: logins, commits: main, since: p.since, until: p.until });
    expect(byLogin(r)['kabir-s'].commits).toBe(0);
    expect(r.warnings).toContain('kabir-s has 0 valid commits');
  });

  test('UI docs repo is dominated by Isha and the sandbox repo is empty', () => {
    const docs = mock.repos.find((r) => r.fullName === 'mrinalg297/vicollab-docs').commits;
    expect(byLogin(scoreContributions({ members: logins, commits: docs }))['isha-rao'].score).toBeGreaterThan(60);
    expect(mock.repos.find((r) => r.fullName === 'mrinalg297/sandbox').commits).toEqual([]);
  });

  test('UI a range after the project has no commits (dashboard empty state)', async () => {
    const res = await request(app).post('/api/contributions/score')
      .send({ members: logins, commits: main, since: '2026-10-19', until: '2026-10-25' });
    expect(res.status).toBe(200);
    expect(res.body.team.totalCommits).toBe(0);
    expect(res.body.warnings).toContain('No valid commits left to score');
  });

  test('UI a reversed range is rejected by the API (invalid date range state)', async () => {
    const res = await request(app).post('/api/contributions/score')
      .send({ members: logins, commits: main, since: '2026-10-18', until: '2026-07-27' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/after/);
  });

  test('UI the data is the same on every load (seeded)', () => {
    jest.isolateModules(() => {
      const again = require('../public/app/mock-data.js');
      expect(again.repos[0].commits).toEqual(main);
    });
  });
});
