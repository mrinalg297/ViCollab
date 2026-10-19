// Contribution scoring for a ViCollab team.
// Takes a list of commits (mocked GitHub data) and works out each member's share.
// Pure function: no I/O, no Express, so it is easy to unit test.

const COMMIT_WEIGHT = 0.6;
const LINES_WEIGHT = 0.4;
const DOMINANT_LIMIT = 60; // % score above which one member "dominates"

// Thrown for problems with the request as a whole (the API turns these into HTTP 400)
class ScoringInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScoringInputError';
  }
}

// part/total as a percentage, rounded to 1 decimal.
// Works on whole numbers so halves (e.g. 21.25) aren't lost to float error (DEF-02).
const percent1 = (part, total) => Math.round((part * 1000) / total) / 10;

const isCount = (n) => Number.isInteger(n) && n >= 0;

// GitHub logins are case-insensitive, so "Meera" and "meera " are the same person
const authorKey = (name) => name.trim().toLowerCase();

// "2026-03-10" style values (no time part)
const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// ISO 8601 like GitHub sends: 2026-03-10, or 2026-03-10T09:30:00Z / +05:30.
// Date.parse() on its own accepts things like "1" or "Tuesday 5" and rolls
// 2026-02-30 over to 2 March, so check the format and the calendar first (DEF-01).
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

function parseIsoDate(value) {
  if (typeof value !== 'string') return NaN;
  const m = ISO_DATE.exec(value);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return NaN;
  return Date.parse(value); // NaN for bad times like T25:00
}

function parseFilterDate(value, name, endOfDay) {
  if (value === undefined || value === null || value === '') return null;
  const t = parseIsoDate(value);
  if (Number.isNaN(t)) {
    throw new ScoringInputError(`"${name}" is not a valid date: ${JSON.stringify(value)}`);
  }
  // until=2026-03-10 should include commits made during the 10th, not stop at midnight
  if (endOfDay && isDateOnly(value)) return t + 24 * 60 * 60 * 1000 - 1;
  return t;
}

// Returns a reason string if the commit is unusable, otherwise null
function checkCommit(c) {
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return 'commit is not an object';
  if (typeof c.sha !== 'string' || c.sha.trim() === '') return 'missing sha';
  if (typeof c.author !== 'string' || c.author.trim() === '') return 'missing author';
  if (!isCount(c.additions)) return 'additions must be a whole number of 0 or more';
  if (!isCount(c.deletions)) return 'deletions must be a whole number of 0 or more';
  if (Number.isNaN(parseIsoDate(c.date))) return 'invalid date';
  if (c.message !== undefined && typeof c.message !== 'string') return 'message must be text';
  return null;
}

function scoreContributions({ commits, members, since, until } = {}) {
  if (!Array.isArray(commits) || commits.length === 0) {
    throw new ScoringInputError('"commits" must be a non-empty array of commit objects');
  }
  if (members !== undefined && !(Array.isArray(members) && members.every((m) => typeof m === 'string' && m.trim()))) {
    throw new ScoringInputError('"members" must be an array of author names');
  }

  const from = parseFilterDate(since, 'since', false);
  const to = parseFilterDate(until, 'until', true);
  if (from !== null && to !== null && from > to) {
    throw new ScoringInputError('"since" is after "until"');
  }

  const errors = [];
  const skipped = { duplicates: 0, merges: 0, outsideDateRange: 0 };
  const seenShas = new Set();

  // per-member totals, keyed by lowercased author
  const totals = new Map();
  const addMember = (name) => {
    const key = authorKey(name);
    if (!totals.has(key)) totals.set(key, { author: name.trim(), commits: 0, linesChanged: 0 });
    return totals.get(key);
  };
  // listed team members show up even if they have no commits
  (members || []).forEach(addMember);

  commits.forEach((c, index) => {
    const reason = checkCommit(c);
    if (reason) {
      errors.push({ index, sha: c && typeof c.sha === 'string' ? c.sha : null, reason });
      return;
    }
    if (seenShas.has(c.sha)) {
      skipped.duplicates++;
      return;
    }
    seenShas.add(c.sha);

    // "Merge pull request #12..." / "Merge branch 'x'" but not "Mergesort ..."
    if (/^Merge\b/.test((c.message || '').trim())) {
      skipped.merges++;
      return;
    }

    const t = parseIsoDate(c.date);
    if ((from !== null && t < from) || (to !== null && t > to)) {
      skipped.outsideDateRange++;
      return;
    }

    const m = addMember(c.author);
    m.commits++;
    m.linesChanged += c.additions + c.deletions;
  });

  const list = [...totals.values()];
  const totalCommits = list.reduce((sum, m) => sum + m.commits, 0);
  const totalLines = list.reduce((sum, m) => sum + m.linesChanged, 0);

  const results = list.map((m) => {
    // guard against dividing by zero (no commits left, or only empty commits)
    const commitShare = totalCommits ? percent1(m.commits, totalCommits) : 0;
    const linesShare = totalLines ? percent1(m.linesChanged, totalLines) : 0;

    // score = 0.6 * commitShare + 0.4 * linesShare, done as one fraction over
    // totalCommits * totalLines so it is rounded once, from the exact value
    let score = 0;
    if (totalCommits && totalLines) {
      const w1 = COMMIT_WEIGHT * 10, w2 = LINES_WEIGHT * 10; // 6 and 4
      score = percent1(w1 * m.commits * totalLines + w2 * m.linesChanged * totalCommits, 10 * totalCommits * totalLines);
    } else if (totalCommits) {
      score = percent1(COMMIT_WEIGHT * 10 * m.commits, 10 * totalCommits);
    }

    return {
      author: m.author,
      commits: m.commits,
      linesChanged: m.linesChanged,
      commitShare,
      linesShare,
      score,
    };
  });
  results.sort((a, b) => b.score - a.score || a.author.localeCompare(b.author));

  const warnings = [];
  if (totalCommits === 0) warnings.push('No valid commits left to score');
  if (results.length >= 2) {
    results
      .filter((m) => m.score > DOMINANT_LIMIT)
      .forEach((m) => warnings.push(`${m.author} has ${m.score}% of the score (above ${DOMINANT_LIMIT}%), work may be unevenly split`));
  }
  results
    .filter((m) => m.commits === 0)
    .forEach((m) => warnings.push(`${m.author} has 0 valid commits`));

  return {
    team: { memberCount: results.length, totalCommits, totalLinesChanged: totalLines },
    members: results,
    skipped,
    errors,
    warnings,
  };
}

module.exports = { scoreContributions, ScoringInputError, DOMINANT_LIMIT };
