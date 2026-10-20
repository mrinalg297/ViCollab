// Builds the Postman collection from test-cases/ so Postman, the checker page and Jest
// all use exactly the same request bodies. Run: npm run postman
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'test-cases');
const cases = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));

// Postman test scripts for each case (they run in Postman's "Tests" tab, or in newman)
const checks = {
  'TC-01': [
    "pm.test('status 200', () => pm.response.to.have.status(200));",
    "pm.test('every member scores 33.3', () => pm.response.json().members.forEach(m => pm.expect(m).to.include({ commits: 2, linesChanged: 100, commitShare: 33.3, linesShare: 33.3, score: 33.3 })));",
    "pm.test('no warnings or errors', () => { pm.expect(pm.response.json().warnings).to.eql([]); pm.expect(pm.response.json().errors).to.eql([]); });",
  ],
  'TC-02': [
    "pm.test('status 200', () => pm.response.to.have.status(200));",
    "const m = Object.fromEntries(pm.response.json().members.map(x => [x.author, x]));",
    "pm.test('Aarav 60 / 70 / 64', () => pm.expect(m.Aarav).to.include({ commitShare: 60, linesShare: 70, score: 64 }));",
    "pm.test('Meera 20, Kabir 16', () => { pm.expect(m.Meera.score).to.equal(20); pm.expect(m.Kabir.score).to.equal(16); });",
    "pm.test('one dominance warning about Aarav', () => { const w = pm.response.json().warnings; pm.expect(w).to.have.length(1); pm.expect(w[0]).to.include('Aarav'); });",
  ],
  'TC-03': [
    "pm.test('status 200', () => pm.response.to.have.status(200));",
    "pm.test('Isha scores 100', () => pm.expect(pm.response.json().members).to.eql([{ author: 'Isha', commits: 3, linesChanged: 100, commitShare: 100, linesShare: 100, score: 100 }]));",
    "pm.test('no warnings for a one-person team', () => pm.expect(pm.response.json().warnings).to.eql([]));",
  ],
  'TC-04': [
    "pm.test('status 200', () => pm.response.to.have.status(200));",
    "const m = Object.fromEntries(pm.response.json().members.map(x => [x.author, x]));",
    "pm.test('Isha listed with zeros', () => pm.expect(m.Isha).to.include({ commits: 0, linesChanged: 0, score: 0 }));",
    "pm.test('scores 54 / 23 / 23', () => { pm.expect(m.Aarav.score).to.equal(54); pm.expect(m.Meera.score).to.equal(23); pm.expect(m.Kabir.score).to.equal(23); });",
    "pm.test('zero-commit warning', () => pm.expect(pm.response.json().warnings).to.eql(['Isha has 0 valid commits']));",
  ],
  'TC-05': [
    "pm.test('status 200', () => pm.response.to.have.status(200));",
    "pm.test('2 duplicates skipped', () => pm.expect(pm.response.json().skipped.duplicates).to.equal(2));",
    "pm.test('each member 1 commit, score 50', () => pm.response.json().members.forEach(m => pm.expect(m).to.include({ commits: 1, linesChanged: 50, score: 50 })));",
  ],
  'TC-06': [
    "pm.test('status 200', () => pm.response.to.have.status(200));",
    "const m = Object.fromEntries(pm.response.json().members.map(x => [x.author, x]));",
    "pm.test('2 merge commits skipped', () => pm.expect(pm.response.json().skipped.merges).to.equal(2));",
    "pm.test('scores 32 / 32 / 36', () => { pm.expect(m.Aarav.score).to.equal(32); pm.expect(m.Meera.score).to.equal(32); pm.expect(m.Kabir).to.include({ commits: 1, linesChanged: 40, score: 36 }); });",
  ],
  'TC-07': [
    "pm.test('status 200 (no crash)', () => pm.response.to.have.status(200));",
    "pm.test('4 errors at index 2-5', () => pm.expect(pm.response.json().errors.map(e => e.index)).to.eql([2, 3, 4, 5]));",
    "const m = Object.fromEntries(pm.response.json().members.map(x => [x.author, x]));",
    "pm.test('valid commits scored 46 / 54', () => { pm.expect(m.Aarav.score).to.equal(46); pm.expect(m.Meera.score).to.equal(54); });",
  ],
  'TC-08': [
    "pm.test('status 200', () => pm.response.to.have.status(200));",
    "const m = Object.fromEntries(pm.response.json().members.map(x => [x.author, x]));",
    "pm.test('2 commits outside the range', () => pm.expect(pm.response.json().skipped.outsideDateRange).to.equal(2));",
    "pm.test('Meera commit on the until day is kept', () => pm.expect(m.Meera.commits).to.equal(1));",
    "pm.test('Kabir has 0 and a warning', () => { pm.expect(m.Kabir.commits).to.equal(0); pm.expect(pm.response.json().warnings).to.eql(['Kabir has 0 valid commits']); });",
  ],
  'TC-09': [
    "pm.test('status 400', () => pm.response.to.have.status(400));",
    "pm.test('clear message', () => pm.expect(pm.response.json().error).to.equal('\"commits\" must be a non-empty array of commit objects'));",
  ],
  'TC-10': [
    "pm.test('status 400', () => pm.response.to.have.status(400));",
    "pm.test('clear message', () => pm.expect(pm.response.json().error).to.equal('\"commits\" must be a non-empty array of commit objects'));",
  ],
  'TC-11': [
    "pm.test('status 400', () => pm.response.to.have.status(400));",
    "pm.test('JSON error, not an HTML page', () => pm.expect(pm.response.json()).to.eql({ error: 'Request body is not valid JSON' }));",
  ],
  'TC-12': [
    "pm.test('status 200', () => pm.response.to.have.status(200));",
    "const m = Object.fromEntries(pm.response.json().members.map(x => [x.author, x]));",
    "pm.test('Aarav exactly 60.0', () => pm.expect(m.Aarav.score).to.equal(60));",
    "pm.test('no warning at exactly 60', () => pm.expect(pm.response.json().warnings).to.eql([]));",
  ],
  'TC-13': [
    "pm.test('status 200', () => pm.response.to.have.status(200));",
    "pm.test('linesShare 0, score 30, no NaN', () => pm.response.json().members.forEach(m => pm.expect(m).to.include({ commits: 2, linesChanged: 0, commitShare: 50, linesShare: 0, score: 30 })));",
  ],
  'TC-14': [
    "pm.test('status 200', () => pm.response.to.have.status(200));",
    "pm.test('status ok', () => pm.expect(pm.response.json()).to.include({ status: 'ok', service: 'contribution-scoring' }));",
  ],
};

const item = cases.map((c) => {
  const request = {
    method: c.method,
    header: [],
    url: { raw: `{{baseUrl}}${c.path}`, host: ['{{baseUrl}}'], path: c.path.split('/').filter(Boolean) },
    description: `${c.scenario}\n\nExpected: ${c.expected}`,
  };
  if (c.file) {
    request.header.push({ key: 'Content-Type', value: 'application/json' });
    // LF on every OS (a Windows checkout has CRLF), so the collection doesn't change per machine
    request.body = { mode: 'raw', raw: fs.readFileSync(path.join(dir, c.file), 'utf8').replace(/\r\n/g, '\n'), options: { raw: { language: 'json' } } };
  }
  return {
    name: `${c.id} ${c.scenario}`,
    event: [{ listen: 'test', script: { type: 'text/javascript', exec: checks[c.id] } }],
    request,
  };
});

// AI endpoints. Bad input is rejected before the model is called, so those checks are exact.
// The others pass with 200 (Ollama running) or 503 { error: 'AI unavailable' } (Ollama off).
const aiOk = (bodyChecks) => [
  "pm.test('200, or 503 when Ollama is not running', () => pm.expect(pm.response.code).to.be.oneOf([200, 503]));",
  "if (pm.response.code === 503) pm.test('503 body is AI unavailable', () => pm.expect(pm.response.json()).to.eql({ error: 'AI unavailable' }));",
  ...bodyChecks.map((c) => `if (pm.response.code === 200) ${c}`),
];
const aiStatus = (code, pattern) => [
  `pm.test('status ${code}', () => pm.response.to.have.status(${code}));`,
  `pm.test('clear error message', () => pm.expect(pm.response.json().error).to.match(${pattern}));`,
];
const sprint1 = { since: '2026-07-27', until: '2026-08-09' };
const aiCases = [
  ['AI-01 Grounded chat answers a question from the scoring tool', 'chat', { message: 'Who did the most work in Sprint 1?' },
    aiOk(["pm.test('reply text and the tools it used', () => { pm.expect(pm.response.json().reply).to.be.a('string').and.not.empty; pm.expect(pm.response.json().sources).to.be.an('array'); });"])],
  ['AI-02 Chat without a message is rejected', 'chat', { history: [] }, aiStatus(400, '/message/')],
  ['AI-03 Classify commit messages', 'classify', { commits: [
    { sha: 'pm-a1', message: 'feat: github oauth callback' }, { sha: 'pm-a2', message: 'fix: token refresh race' },
    { sha: 'pm-a3', message: 'test: scoring unit tests' }, { sha: 'pm-a4', message: 'docs: setup guide' },
    { sha: 'pm-a5', message: 'chore: bump express' }] },
  aiOk(["pm.test('one label per commit from the fixed list', () => { const r = pm.response.json().results; pm.expect(r).to.have.length(5); r.forEach(x => { pm.expect(['feat','fix','test','docs','chore','refactor']).to.include(x.type); pm.expect(x.trivial).to.be.a('boolean'); }); });"])],
  ['AI-04 Classify with an empty list is rejected', 'classify', { commits: [] }, aiStatus(400, '/commits/')],
  ['AI-05 Member summary for Kabir in Sprint 1', 'summary/kabir-s', sprint1,
    aiOk(["pm.test('summary and role flag', () => { pm.expect(pm.response.json().summary).to.be.a('string').and.not.empty; pm.expect(pm.response.json().roleMismatch).to.be.a('boolean'); pm.expect(pm.response.json().stats.score).to.equal(62.2); });"])],
  ['AI-06 Summary for an unknown member is 404', 'summary/zoe', {}, aiStatus(404, '/No team member/')],
  ['AI-07 Explain the Sprint 1 dominance warning', 'explain-warning', sprint1,
    aiOk(["pm.test('explains Kabir, with caveats', () => { pm.expect(pm.response.json().member).to.equal('kabir-s'); pm.expect(pm.response.json().explanation).to.be.a('string').and.not.empty; pm.expect(pm.response.json().caveats).to.be.an('array'); });"])],
  ['AI-08 Explain when there is no warning (all 12 weeks) is rejected', 'explain-warning', {}, aiStatus(400, '/no dominance warning/')],
  ['AI-09 Streamed chat sends events, ending with a checked answer', 'chat', { message: 'How many commits did Isha make in the last 4 weeks?', stream: true },
    aiOk(["pm.test('one JSON event per line, the last one done', () => { const ev = pm.response.text().trim().split('\\n').map(l => JSON.parse(l)); pm.expect(ev.some(e => e.type === 'delta')).to.equal(true); const last = ev[ev.length - 1]; pm.expect(last.type).to.equal('done'); pm.expect(last.grounded).to.be.a('boolean'); });"])],
  ['AI-10 Regenerate a saved summary', 'summary/kabir-s', { ...sprint1, regenerate: true },
    aiOk(["pm.test('freshly written, with a time', () => { pm.expect(pm.response.json().cached).to.equal(false); pm.expect(Date.parse(pm.response.json().generatedAt)).to.be.a('number').and.not.NaN; });"])],
  ['AI-11 Regenerate must be true or false', 'summary/kabir-s', { ...sprint1, regenerate: 'yes' }, aiStatus(400, '/regenerate/')],
];
item.push({
  name: 'AI features (local Qwen3 via Ollama)',
  description: 'Needs the server; the AI requests also pass with 503 when Ollama is not running.',
  item: aiCases.map(([name, route, body, exec]) => ({
    name,
    event: [{ listen: 'test', script: { type: 'text/javascript', exec } }],
    request: {
      method: 'POST',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      url: { raw: `{{baseUrl}}/api/ai/${route}`, host: ['{{baseUrl}}'], path: ['api', 'ai', ...route.split('/')] },
      body: { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } },
    },
  })),
});

const collection = {
  info: {
    name: 'ViCollab Contribution Scoring',
    description: 'Test cases TC-01 to TC-14 for POST /api/contributions/score and GET /api/health, plus AI-01 to AI-08 for /api/ai/*. Start the server with npm start first.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item,
  variable: [{ key: 'baseUrl', value: 'http://localhost:3000' }],
};

const out = path.join(__dirname, '..', 'postman', 'ViCollab_Contribution_Scoring.postman_collection.json');
fs.writeFileSync(out, JSON.stringify(collection, null, 2) + '\n');
const count = item.reduce((n, i) => n + (i.item ? i.item.length : 1), 0);
console.log(`Wrote ${count} requests to ${path.relative(process.cwd(), out)}`);
