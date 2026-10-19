// Integration tests for the Express endpoints, using Supertest (no real server needed).
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');

const SCORE = '/api/contributions/score';
const raw = (file) => fs.readFileSync(path.join(__dirname, '..', 'test-cases', file), 'utf8');
const load = (id) => JSON.parse(raw(`${id}.json`));
const byName = (body) => Object.fromEntries(body.members.map((m) => [m.author, m]));

describe('POST /api/contributions/score', () => {
  test('TC-01 balanced team returns 200 with equal scores', async () => {
    const res = await request(app).post(SCORE).send(load('TC-01'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.members.map((m) => m.score)).toEqual([33.3, 33.3, 33.3]);
    expect(res.body.warnings).toEqual([]);
  });

  test('TC-02 dominant member returns a warning', async () => {
    const res = await request(app).post(SCORE).send(load('TC-02'));
    expect(res.status).toBe(200);
    expect(byName(res.body).Aarav.score).toBe(64);
    expect(res.body.warnings).toEqual([expect.stringContaining('Aarav')]);
  });

  test('TC-03 single member scores 100', async () => {
    const res = await request(app).post(SCORE).send(load('TC-03'));
    expect(res.status).toBe(200);
    expect(res.body.members).toEqual([expect.objectContaining({ author: 'Isha', score: 100 })]);
    expect(res.body.warnings).toEqual([]);
  });

  test('TC-04 zero-commit member is listed with a warning', async () => {
    const res = await request(app).post(SCORE).send(load('TC-04'));
    expect(res.status).toBe(200);
    expect(byName(res.body).Isha.commits).toBe(0);
    expect(res.body.warnings).toEqual(['Isha has 0 valid commits']);
  });

  test('TC-05 duplicates are skipped', async () => {
    const res = await request(app).post(SCORE).send(load('TC-05'));
    expect(res.status).toBe(200);
    expect(res.body.skipped.duplicates).toBe(2);
    expect(byName(res.body).Aarav.commits).toBe(1);
  });

  test('TC-06 merge commits are skipped', async () => {
    const res = await request(app).post(SCORE).send(load('TC-06'));
    expect(res.status).toBe(200);
    expect(res.body.skipped.merges).toBe(2);
    expect(byName(res.body).Kabir).toMatchObject({ commits: 1, score: 36 });
  });

  test('TC-07 invalid commits come back in errors with status 200', async () => {
    const res = await request(app).post(SCORE).send(load('TC-07'));
    expect(res.status).toBe(200);
    expect(res.body.errors.map((e) => e.index)).toEqual([2, 3, 4, 5]);
    expect(byName(res.body).Meera.score).toBe(54);
  });

  test('TC-08 date filter is applied', async () => {
    const res = await request(app).post(SCORE).send(load('TC-08'));
    expect(res.status).toBe(200);
    expect(res.body.skipped.outsideDateRange).toBe(2);
    expect(byName(res.body).Meera.commits).toBe(1);
  });

  test('TC-08 invalid since returns 400', async () => {
    const res = await request(app).post(SCORE).send({ ...load('TC-08'), since: 'yesterday' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/since/);
  });

  test('TC-09 empty commit list returns 400 with a clear message', async () => {
    const res = await request(app).post(SCORE).send(load('TC-09'));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '"commits" must be a non-empty array of commit objects' });
  });

  test('TC-10 missing commits returns 400', async () => {
    const res = await request(app).post(SCORE).send(load('TC-10'));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('"commits" must be a non-empty array of commit objects');
  });

  test('TC-10 no body at all returns 400', async () => {
    const res = await request(app).post(SCORE);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No JSON body received/);
  });

  test('TC-10 a top-level array instead of an object returns 400', async () => {
    const res = await request(app).post(SCORE).send(load('TC-01').commits);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON object/);
  });

  // DEF-03 regression: the old message said "must be a JSON object" even when it was one
  test('TC-11 JSON sent with the wrong Content-Type explains the header (DEF-03)', async () => {
    const res = await request(app).post(SCORE).set('Content-Type', 'text/plain').send(raw('TC-01.json'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Content-Type: application\/json/);
  });

  test('TC-11 body over 1 MB returns 413 JSON', async () => {
    const big = { commits: Array.from({ length: 12000 }, (_, i) => ({ sha: 's' + i, author: 'A', additions: 1, deletions: 1, date: '2026-03-02T10:00:00Z', message: 'x'.repeat(100) })) };
    const res = await request(app).post(SCORE).send(big);
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/);
  });

  test('TC-11 malformed JSON returns a 400 JSON error and the server keeps working', async () => {
    const res = await request(app).post(SCORE).set('Content-Type', 'application/json').send(raw('TC-11.txt'));
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual({ error: 'Request body is not valid JSON' });

    const after = await request(app).get('/api/health');
    expect(after.status).toBe(200);
  });

  test('TC-12 exactly 60% gives no warning', async () => {
    const res = await request(app).post(SCORE).send(load('TC-12'));
    expect(res.status).toBe(200);
    expect(byName(res.body).Aarav.score).toBe(60);
    expect(res.body.warnings).toEqual([]);
  });

  test('TC-13 zero lines changed gives numbers, not NaN/null', async () => {
    const res = await request(app).post(SCORE).send(load('TC-13'));
    expect(res.status).toBe(200);
    expect(res.body.members.map((m) => [m.linesShare, m.score])).toEqual([[0, 30], [0, 30]]);
  });
});

describe('other routes', () => {
  test('TC-14 GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'contribution-scoring' });
    expect(Number.isNaN(Date.parse(res.body.time))).toBe(false);
  });

  test('TC-14 unknown API route returns JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No route/);
  });

  test('TC-14 home page and checker page are served, home links to the checker', async () => {
    const home = await request(app).get('/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('href="contribution-checker.html"');
    const checker = await request(app).get('/contribution-checker.html');
    expect(checker.status).toBe(200);
    expect(checker.text).toContain('Load sample data');
  });
});

describe('unexpected errors', () => {
  test('TC-11 a crash inside scoring returns a JSON 500 without the stack trace', async () => {
    let brokenApp;
    jest.isolateModules(() => {
      jest.doMock('../src/scoring', () => ({
        ...jest.requireActual('../src/scoring'),
        scoreContributions: () => { throw new Error('boom'); },
      }));
      brokenApp = require('../src/app');
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(brokenApp).post(SCORE).send(load('TC-01'));
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Something went wrong on the server' });
    expect(res.text).not.toContain('boom');
  });
});
