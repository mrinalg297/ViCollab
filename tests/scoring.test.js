// Unit tests for the pure scoring function. Test names start with the TC ID they cover.
const fs = require('fs');
const path = require('path');
const { scoreContributions, ScoringInputError } = require('../src/scoring');

const load = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test-cases', `${id}.json`), 'utf8'));
const byName = (result) => Object.fromEntries(result.members.map((m) => [m.author, m]));

// small helper for hand-made commits
const commit = (sha, author, additions, deletions, date = '2026-03-02T10:00:00Z', message = 'work') =>
  ({ sha, author, additions, deletions, date, message });

describe('TC-01 balanced team', () => {
  test('TC-01 every member gets an equal third', () => {
    const r = scoreContributions(load('TC-01'));
    expect(r.members).toHaveLength(3);
    for (const m of r.members) {
      expect(m).toMatchObject({ commits: 2, linesChanged: 100, commitShare: 33.3, linesShare: 33.3, score: 33.3 });
    }
    expect(r.team).toEqual({ memberCount: 3, totalCommits: 6, totalLinesChanged: 300 });
    expect(r.warnings).toEqual([]);
    expect(r.errors).toEqual([]);
  });
});

describe('TC-02 one dominant member', () => {
  test('TC-02 shares and scores use 0.6 / 0.4 weights', () => {
    const m = byName(scoreContributions(load('TC-02')));
    expect(m.Aarav).toMatchObject({ commits: 6, linesChanged: 700, commitShare: 60, linesShare: 70, score: 64 });
    expect(m.Meera).toMatchObject({ commits: 2, linesChanged: 200, commitShare: 20, linesShare: 20, score: 20 });
    expect(m.Kabir).toMatchObject({ commits: 2, linesChanged: 100, commitShare: 20, linesShare: 10, score: 16 });
  });

  test('TC-02 warns that Aarav is above 60%', () => {
    const r = scoreContributions(load('TC-02'));
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/Aarav.*64%.*above 60%/);
  });

  test('TC-02 members are sorted by score, highest first', () => {
    const r = scoreContributions(load('TC-02'));
    expect(r.members.map((m) => m.author)).toEqual(['Aarav', 'Meera', 'Kabir']);
  });
});

describe('TC-03 single-member team', () => {
  test('TC-03 single member gets 100 and no dominance warning', () => {
    const r = scoreContributions(load('TC-03'));
    expect(r.members).toEqual([
      { author: 'Isha', commits: 3, linesChanged: 100, commitShare: 100, linesShare: 100, score: 100 },
    ]);
    expect(r.warnings).toEqual([]);
  });
});

describe('TC-04 member with zero commits', () => {
  test('TC-04 listed member with no commits is shown with zeros and a warning', () => {
    const r = scoreContributions(load('TC-04'));
    const m = byName(r);
    expect(m.Isha).toEqual({ author: 'Isha', commits: 0, linesChanged: 0, commitShare: 0, linesShare: 0, score: 0 });
    expect(m.Aarav).toMatchObject({ commitShare: 50, linesShare: 60, score: 54 });
    expect(m.Meera).toMatchObject({ commitShare: 25, linesShare: 20, score: 23 });
    expect(m.Kabir).toMatchObject({ commitShare: 25, linesShare: 20, score: 23 });
    expect(r.warnings).toEqual(['Isha has 0 valid commits']);
  });

  test('TC-04 author name matching ignores case and spaces (no false zero-commit warning)', () => {
    const r = scoreContributions({
      members: ['Isha', 'Kabir'],
      commits: [commit('x1', 'isha', 10, 0), commit('x2', ' Kabir ', 10, 0)],
    });
    expect(r.members).toHaveLength(2);
    expect(byName(r).Isha.commits).toBe(1);
    expect(byName(r).Kabir.commits).toBe(1);
    expect(r.warnings).toEqual([]);
  });
});

describe('TC-05 duplicate shas', () => {
  test('TC-05 a repeated sha is only counted once', () => {
    const r = scoreContributions(load('TC-05'));
    const m = byName(r);
    expect(m.Aarav).toMatchObject({ commits: 1, linesChanged: 50, score: 50 });
    expect(m.Meera).toMatchObject({ commits: 1, linesChanged: 50, score: 50 });
    expect(r.skipped.duplicates).toBe(2);
  });
});

describe('TC-06 merge commits', () => {
  test('TC-06 messages starting with "Merge" are dropped, "Mergesort" is kept', () => {
    const r = scoreContributions(load('TC-06'));
    const m = byName(r);
    expect(r.skipped.merges).toBe(2);
    expect(r.team.totalCommits).toBe(3);
    expect(m.Aarav).toMatchObject({ commits: 1, linesChanged: 30, commitShare: 33.3, linesShare: 30, score: 32 });
    expect(m.Meera).toMatchObject({ commits: 1, linesChanged: 30, commitShare: 33.3, linesShare: 30, score: 32 });
    expect(m.Kabir).toMatchObject({ commits: 1, linesChanged: 40, commitShare: 33.3, linesShare: 40, score: 36 });
  });
});

describe('TC-06 merge commits (message is optional)', () => {
  test('TC-06 a commit with no message is counted normally', () => {
    const { message, ...noMessage } = commit('nm1', 'Aarav', 5, 5);
    const r = scoreContributions({ commits: [noMessage] });
    expect(r.errors).toEqual([]);
    expect(r.skipped.merges).toBe(0);
    expect(r.members[0].commits).toBe(1);
  });
});

describe('TC-07 invalid commit data', () => {
  test('TC-07 bad commits go to errors and the valid ones are still scored', () => {
    const r = scoreContributions(load('TC-07'));
    expect(r.errors).toEqual([
      { index: 2, sha: 'i003', reason: 'missing author' },
      { index: 3, sha: 'i004', reason: 'additions must be a whole number of 0 or more' },
      { index: 4, sha: 'i005', reason: 'invalid date' },
      { index: 5, sha: 'i006', reason: 'additions must be a whole number of 0 or more' },
    ]);
    const m = byName(r);
    expect(m.Aarav).toMatchObject({ commits: 1, linesChanged: 40, commitShare: 50, linesShare: 40, score: 46 });
    expect(m.Meera).toMatchObject({ commits: 1, linesChanged: 60, commitShare: 50, linesShare: 60, score: 54 });
  });

  test('TC-07 other kinds of bad entries are reported, not thrown', () => {
    const r = scoreContributions({
      commits: [
        null,
        'a string',
        { author: 'Aarav', additions: 1, deletions: 1, date: '2026-03-02' },
        commit('y1', 'Aarav', 1, -1),
        commit('y2', 'Aarav', 1.5, 0),
        { ...commit('y3', 'Aarav', 1, 1), message: 42 },
        commit('y4', 'Aarav', 5, 5),
      ],
    });
    expect(r.errors.map((e) => e.reason)).toEqual([
      'commit is not an object',
      'commit is not an object',
      'missing sha',
      'deletions must be a whole number of 0 or more',
      'additions must be a whole number of 0 or more',
      'message must be text',
    ]);
    expect(r.members).toEqual([
      { author: 'Aarav', commits: 1, linesChanged: 10, commitShare: 100, linesShare: 100, score: 100 },
    ]);
  });

  test('TC-07 when every commit is invalid the result is empty with a warning', () => {
    const r = scoreContributions({ members: ['Aarav'], commits: [commit('z1', '', 1, 1)] });
    expect(r.errors).toHaveLength(1);
    expect(r.team.totalCommits).toBe(0);
    expect(r.warnings).toContain('No valid commits left to score');
    expect(r.warnings).toContain('Aarav has 0 valid commits');
  });

  // DEF-01 regression: Date.parse() alone accepted "1", "Tuesday 5", "2026-02-30"...
  test('TC-07 vague or impossible date strings are reported as invalid (DEF-01)', () => {
    const bad = ['1', '12', 'Tuesday 5', 'March 3', '3/4/2026', '2026-02-30', '2026-03-02T10:00:00'];
    const r = scoreContributions({
      commits: [commit('ok1', 'Aarav', 5, 5), ...bad.map((d, i) => commit('bad' + i, 'Meera', 5, 5, d))],
    });
    expect(r.errors.map((e) => e.sha)).toEqual(bad.map((_, i) => 'bad' + i));
    expect(r.errors.every((e) => e.reason === 'invalid date')).toBe(true);
    expect(r.members.map((m) => m.author)).toEqual(['Aarav']);
  });

  test('TC-07 real ISO dates in different forms are still accepted (DEF-01)', () => {
    const good = ['2026-03-02', '2026-03-02T10:00:00Z', '2026-03-02T10:00:00.123Z', '2026-03-02T15:30:00+05:30', '2024-02-29T00:00:00Z'];
    const r = scoreContributions({ commits: good.map((d, i) => commit('g' + i, 'Aarav', 1, 0, d)) });
    expect(r.errors).toEqual([]);
    expect(r.members[0].commits).toBe(good.length);
  });
});

describe('TC-08 date filter', () => {
  test('TC-08 since/until keep only commits in range, until day is inclusive', () => {
    const r = scoreContributions(load('TC-08'));
    const m = byName(r);
    expect(r.skipped.outsideDateRange).toBe(2);
    expect(m.Aarav).toMatchObject({ commits: 1, linesChanged: 50, score: 50 });
    expect(m.Meera).toMatchObject({ commits: 1, linesChanged: 50, score: 50 });
    expect(m.Kabir).toMatchObject({ commits: 0, score: 0 });
    expect(r.warnings).toEqual(['Kabir has 0 valid commits']);
  });

  test('TC-08 only since, or only until, also works', () => {
    const data = load('TC-08');
    const onlySince = scoreContributions({ ...data, until: undefined });
    expect(onlySince.skipped.outsideDateRange).toBe(1); // only the February commit
    const onlyUntil = scoreContributions({ ...data, since: undefined });
    expect(onlyUntil.skipped.outsideDateRange).toBe(1); // only the 20 March commit
  });

  test('TC-08 an until value with a time is used as given', () => {
    const r = scoreContributions({ ...load('TC-08'), until: '2026-03-15T12:00:00Z' });
    expect(byName(r).Meera.commits).toBe(0); // 18:30 is after 12:00
  });

  test('TC-08 bad filter dates are rejected', () => {
    const data = load('TC-08');
    expect(() => scoreContributions({ ...data, since: 'last week' })).toThrow(ScoringInputError);
    expect(() => scoreContributions({ ...data, until: 20260315 })).toThrow(/until/);
    expect(() => scoreContributions({ ...data, since: '2026-03-20', until: '2026-03-01' })).toThrow(/after/);
    expect(() => scoreContributions({ ...data, since: 'March 3' })).toThrow(/since/); // DEF-01
  });
});

describe('TC-09 / TC-10 empty or missing commit list', () => {
  test('TC-09 empty commit list throws a clear input error', () => {
    expect(() => scoreContributions(load('TC-09'))).toThrow(ScoringInputError);
    expect(() => scoreContributions(load('TC-09'))).toThrow('"commits" must be a non-empty array of commit objects');
  });

  test('TC-10 missing commits (or no argument at all) throws the same error', () => {
    expect(() => scoreContributions(load('TC-10'))).toThrow(ScoringInputError);
    expect(() => scoreContributions()).toThrow(ScoringInputError);
    expect(() => scoreContributions({ commits: 'abc' })).toThrow(ScoringInputError);
  });

  test('TC-10 members must be a list of names', () => {
    const commits = [commit('n1', 'Aarav', 1, 1)];
    expect(() => scoreContributions({ commits, members: 'Aarav' })).toThrow(/members/);
    expect(() => scoreContributions({ commits, members: ['Aarav', ''] })).toThrow(/members/);
  });
});

describe('TC-12 dominance boundary', () => {
  test('TC-12 a score of exactly 60.0 does not trigger the warning', () => {
    const r = scoreContributions(load('TC-12'));
    const m = byName(r);
    expect(m.Aarav).toMatchObject({ commits: 3, linesChanged: 60, commitShare: 60, linesShare: 60, score: 60 });
    expect(m.Meera).toMatchObject({ commits: 2, linesChanged: 40, score: 40 });
    expect(r.warnings).toEqual([]);
  });

  // DEF-02 regression: exact score 60.05 came out as 60.0 because of float error
  test('TC-12 a score of exactly 60.05 rounds to 60.1 and is warned about (DEF-02)', () => {
    const commits = [];
    for (let i = 0; i < 14; i++) commits.push(commit('q' + i, 'Aarav', i === 0 ? 81 : 0, 0));
    commits.push(commit('q14', 'Meera', 719, 0));
    // Aarav: 14/15 commits, 81/800 lines => 56 + 4.05 = 60.05
    const r = scoreContributions({ commits });
    expect(byName(r).Aarav.score).toBe(60.1);
    expect(r.warnings).toHaveLength(1);
  });

  test('TC-12 halves round up, e.g. 21.25 -> 21.3 (DEF-02)', () => {
    // Aarav: 1/3 commits, 1/32 lines => 20 + 1.25 = 21.25; Meera: 40 + 38.75 = 78.75
    const r = scoreContributions({ commits: [commit('h1', 'Aarav', 1, 0), commit('h2', 'Meera', 15, 0), commit('h3', 'Meera', 16, 0)] });
    expect(byName(r).Aarav.score).toBe(21.3);
    expect(byName(r).Meera.score).toBe(78.8);
  });

  test('TC-12 rounding matches exact fraction maths on a grid of team sizes (DEF-02)', () => {
    // compare against integer-only rounding for many commit/line splits between two people
    const wrong = [];
    for (let n = 2; n <= 12; n++) {
      for (let k = 1; k < n; k++) {
        for (let L = 1; L <= 40; L++) {
          for (let l = 0; l <= L; l++) {
            const commits = [];
            for (let i = 0; i < n; i++) commits.push(commit(`${n}-${i}`, i < k ? 'A' : 'B', 0, 0));
            commits[0].additions = l;
            commits[n - 1].additions = L - l;
            const a = byName(scoreContributions({ commits })).A;
            const num = 600 * k * L + 400 * l * n, den = n * L; // score * 10 as a fraction
            const exact = Math.floor((2 * num + den) / (2 * den)) / 10;
            if (a.score !== exact) wrong.push({ n, k, L, l, got: a.score, exact });
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test('TC-12 just above 60 does trigger it', () => {
    // 2 of 3 commits (66.7%) and 55 of 100 lines => 0.6*66.67 + 0.4*55 = 62.0
    const r = scoreContributions({
      commits: [commit('p1', 'Aarav', 30, 0), commit('p2', 'Aarav', 25, 0), commit('p3', 'Meera', 45, 0)],
    });
    expect(byName(r).Aarav.score).toBe(62);
    expect(r.warnings).toHaveLength(1);
  });
});

describe('TC-13 zero lines changed', () => {
  test('TC-13 only empty commits: no NaN, linesShare is 0', () => {
    const r = scoreContributions(load('TC-13'));
    for (const m of r.members) {
      expect(m).toMatchObject({ commits: 2, linesChanged: 0, commitShare: 50, linesShare: 0, score: 30 });
    }
    expect(JSON.stringify(r)).not.toMatch(/NaN|null/);
  });
});

describe('general', () => {
  test('TC-01 the input array is not changed', () => {
    const data = load('TC-01');
    const copy = JSON.parse(JSON.stringify(data));
    scoreContributions(data);
    expect(data).toEqual(copy);
  });
});
