// Mock GitHub data for Team 20 (no real OAuth or GitHub API calls).
// Commit counts per week follow the sample team on the home page, so both pages tell the same story.
// A seeded random generator keeps the data identical on every load.
// Works in the browser (window.VicollabMock) and in Node/Jest (module.exports).
(function (root) {
  const DAY = 24 * 60 * 60 * 1000;
  const START = Date.UTC(2026, 6, 27); // Monday 27 July 2026 = week 1
  const WEEKS = 12;

  const team = {
    name: 'Team 20 · ViCollab',
    course: 'BCSE301P Software Engineering Lab',
    viewer: 'mrinalg297', // the account that "connects" GitHub
  };

  const members = [
    { login: 'aarav-m', name: 'Aarav Mehta', role: 'Backend lead', skills: ['Node.js', 'OAuth', 'PostgreSQL'] },
    { login: 'meera-iyer', name: 'Meera Iyer', role: 'Frontend', skills: ['React', 'UI design', 'Accessibility'] },
    { login: 'kabir-s', name: 'Kabir Singh', role: 'Real-time', skills: ['Socket.io', 'Redis'] },
    { login: 'isha-rao', name: 'Isha Rao', role: 'QA and docs', skills: ['Testing', 'Docs', 'Jest'] },
  ];

  // commits per week, weeks 1-12 (same as the home page "proof" section)
  const weekly = {
    'aarav-m': [2, 5, 9, 12, 8, 7, 10, 6, 9, 11, 7, 8],
    'meera-iyer': [1, 3, 6, 8, 11, 9, 7, 10, 12, 9, 8, 6],
    'kabir-s': [6, 7, 4, 2, 1, 0, 0, 1, 0, 0, 0, 0],
    'isha-rao': [0, 1, 0, 2, 3, 0, 4, 0, 2, 1, 0, 3],
  };

  // typical size of a commit: [min, max] additions and deletions
  const size = {
    'aarav-m': [[20, 150], [4, 50]],
    'meera-iyer': [[15, 130], [5, 45]],
    'kabir-s': [[60, 260], [10, 70]], // big scaffolding commits early on
    'isha-rao': [[8, 70], [0, 18]],
  };

  const messages = {
    'aarav-m': ['feat: github oauth callback', 'feat: team invite api', 'fix: token refresh race', 'feat: contribution scoring endpoint',
      'refactor: split services folder', 'feat: task assignment api', 'fix: validate repo url', 'perf: index commits by author',
      'feat: github webhook handler', 'chore: bump express', 'fix: handle revoked oauth token', 'feat: faculty group api'],
    'meera-iyer': ['feat: dashboard layout', 'style: summary cards', 'feat: member detail page', 'fix: dark mode contrast',
      'feat: sortable member table', 'feat: date range picker', 'style: mobile sidebar', 'fix: focus ring on buttons',
      'feat: export csv', 'feat: empty states', 'refactor: shared nav component', 'fix: chart tooltip overflow'],
    'kabir-s': ['feat: socket.io chat server', 'feat: chat rooms per team', 'feat: typing indicator', 'fix: socket reconnect on idle',
      'feat: redis adapter for sockets', 'chore: chat load test script', 'fix: duplicate chat messages'],
    'isha-rao': ['test: scoring unit tests', 'test: api integration tests', 'docs: test report draft', 'docs: setup guide',
      'test: postman collection', 'docs: api reference', 'test: date filter edge cases', 'docs: sprint review notes'],
  };

  function rng(seed) { // mulberry32
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildMainRepo() {
    const rand = rng(20);
    const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const sha = () => Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join('');
    const commits = [];

    for (const m of members) {
      let n = 0;
      weekly[m.login].forEach((count, week) => {
        for (let i = 0; i < count; i++) {
          // spread commits over the week, mostly 10:00-23:00 IST-ish working hours (UTC times)
          const t = START + week * 7 * DAY + between(0, 6) * DAY + between(4, 18) * 3600e3 + between(0, 59) * 60e3;
          const [[a1, a2], [d1, d2]] = size[m.login];
          const early = m.login === 'kabir-s' && week < 2 ? 1.6 : 1;
          const pool = messages[m.login];
          commits.push({
            sha: sha(),
            author: m.login,
            additions: Math.round(between(a1, a2) * early),
            deletions: between(d1, d2),
            date: new Date(t).toISOString().replace('.000', ''),
            message: pool[n++ % pool.length],
          });
        }
      });
    }

    // merge commits (dropped by the scoring rules)
    [['aarav-m', 3, 'Merge pull request #14 from mrinalg297/oauth'],
      ['meera-iyer', 6, 'Merge pull request #31 from mrinalg297/dashboard'],
      ['aarav-m', 9, "Merge branch 'main' into scoring"]].forEach(([author, week, message]) => {
      commits.push({ sha: sha(), author, additions: between(300, 900), deletions: between(50, 200),
        date: new Date(START + week * 7 * DAY + 2 * DAY + 11 * 3600e3).toISOString().replace('.000', ''), message });
    });

    commits.sort((a, b) => a.date.localeCompare(b.date));
    // the same commit seen twice (force-push), the API should count it once
    const again = commits.find((c) => c.author === 'meera-iyer' && c.date > '2026-09-01');
    commits.splice(commits.indexOf(again) + 1, 0, { ...again });
    return commits;
  }

  function buildDocsRepo() {
    const rand = rng(7);
    const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const list = [['isha-rao', 'docs: architecture overview'], ['isha-rao', 'docs: srs document v2'], ['meera-iyer', 'docs: ui wireframes'],
      ['isha-rao', 'docs: test plan'], ['isha-rao', 'docs: user manual'], ['aarav-m', 'docs: api endpoints'],
      ['isha-rao', 'docs: sprint 3 review'], ['isha-rao', 'docs: risk register'], ['meera-iyer', 'docs: style guide'],
      ['isha-rao', 'docs: deployment notes']];
    return list.map(([author, message], i) => ({
      sha: Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join(''),
      author, additions: between(30, 220), deletions: between(0, 40),
      date: new Date(START + i * 8 * DAY + 14 * 3600e3).toISOString().replace('.000', ''), message,
    }));
  }

  const repos = [
    { fullName: 'mrinalg297/vicollab', description: 'Main app: API, web client, chat', commits: buildMainRepo() },
    { fullName: 'mrinalg297/vicollab-docs', description: 'SRS, test plan, reports', commits: buildDocsRepo() },
    { fullName: 'mrinalg297/sandbox', description: 'Empty practice repo', commits: [] },
  ];

  const toDay = (t) => new Date(t).toISOString().slice(0, 10);
  const range = {
    start: toDay(START),
    end: toDay(START + WEEKS * 7 * DAY - DAY), // Sunday 18 Oct 2026
    weekStart: (i) => START + i * 7 * DAY,
    weeks: WEEKS,
    // quick presets for the dashboard
    presets: [
      { id: 'all', label: 'All 12 weeks', since: toDay(START), until: toDay(START + 83 * DAY) },
      { id: 'last4', label: 'Last 4 weeks', since: toDay(START + 56 * DAY), until: toDay(START + 83 * DAY) },
      { id: 'sprint1', label: 'Sprint 1 (weeks 1–2)', since: toDay(START), until: toDay(START + 13 * DAY) },
    ],
  };

  const api = { team, members, repos, range };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VicollabMock = api;
})(typeof window !== 'undefined' ? window : globalThis);
