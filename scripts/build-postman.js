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
    request.body = { mode: 'raw', raw: fs.readFileSync(path.join(dir, c.file), 'utf8'), options: { raw: { language: 'json' } } };
  }
  return {
    name: `${c.id} ${c.scenario}`,
    event: [{ listen: 'test', script: { type: 'text/javascript', exec: checks[c.id] } }],
    request,
  };
});

const collection = {
  info: {
    name: 'ViCollab Contribution Scoring',
    description: 'Test cases TC-01 to TC-14 for POST /api/contributions/score and GET /api/health. Start the server with npm start first.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item,
  variable: [{ key: 'baseUrl', value: 'http://localhost:3000' }],
};

const out = path.join(__dirname, '..', 'postman', 'ViCollab_Contribution_Scoring.postman_collection.json');
fs.writeFileSync(out, JSON.stringify(collection, null, 2) + '\n');
console.log(`Wrote ${item.length} requests to ${path.relative(process.cwd(), out)}`);
