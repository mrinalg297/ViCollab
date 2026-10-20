// AI features on top of the scoring module. None of this changes a score: the
// numbers always come from scoreContributions(), the model only words them.
const mock = require('../public/app/mock-data.js');
const { scoreContributions, ScoringInputError, DOMINANT_LIMIT } = require('./scoring');
const { AIOutputError } = require('./ai');

const DEFAULT_REPO = 'mrinalg297/vicollab';
const MAX_TOOL_ROUNDS = 6;

// Problems with the request itself (400, or 404 for an unknown member)
class AIRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AIRequestError';
    this.status = status;
  }
}

/* ---------- mock data helpers ---------- */
const logins = mock.members.map((m) => m.login);
const isMerge = (c) => /^Merge\b/.test((c.message || '').trim());
const DAY = 24 * 60 * 60 * 1000;
const toDay = (t) => new Date(t).toISOString().slice(0, 10);

function repoCommits(repo = DEFAULT_REPO) {
  const r = mock.repos.find((x) => x.fullName === repo);
  if (!r) throw new AIRequestError(`Unknown repo ${JSON.stringify(repo)}. Use one of: ${mock.repos.map((x) => x.fullName).join(', ')}`);
  return r.commits;
}

// "kabir-s", "Kabir Singh" and "kabir" all mean the same member
function findMember(nameOrLogin) {
  const q = String(nameOrLogin).trim().toLowerCase();
  return mock.members.find((m) => m.login === q || m.name.toLowerCase() === q || m.name.split(' ')[0].toLowerCase() === q);
}

const weeks = () => Array.from({ length: mock.range.weeks }, (_, i) => ({
  week: i + 1,
  since: toDay(mock.range.weekStart(i)),
  until: toDay(mock.range.weekStart(i) + 6 * DAY),
}));

/* ---------- grounding: every number in an answer must come from the data ---------- */
// "1,234", "64.0", "7" but not the 3 in "qwen3" or "W3"
const NUMBER = /(?<![\w.])\d[\d,]*(?:\.\d+)?/g;
const numbersInText = (text) => (String(text).match(NUMBER) || []).map((t) => t.replace(/,+$/, ''));

// every number anywhere in a value: numbers themselves, and digits inside strings (dates, warnings)
function collectNumbers(value, into = new Set()) {
  if (typeof value === 'number' && Number.isFinite(value)) into.add(value);
  else if (typeof value === 'string') numbersInText(value).forEach((t) => into.add(Number(t.replace(/,/g, ''))));
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, into));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectNumbers(v, into));
  return into;
}

// numbers in text that don't match an allowed one. "33" matches 33.3 (rounded to the
// digits written), "64.0" matches 64, list markers like "1." at a line start are ignored.
function ungrounded(text, allowed) {
  const body = String(text).replace(/^\s*\d+[.)]\s/gm, '');
  return numbersInText(body).filter((t) => {
    const n = Number(t.replace(/,/g, ''));
    const digits = (t.split('.')[1] || '').length;
    return ![...allowed].some((v) => Math.abs(Number(v.toFixed(digits)) - n) < 1e-9);
  });
}

/* ---------- 1. grounded chat ---------- */
const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'score_contributions',
      description: 'Contribution scores for a period: per member commits, linesChanged, commitShare, linesShare and score (shares in %), team totals and warnings. Shares are out of the whole team, even when you ask for some members.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'e.g. "Sprint 1", "last 4 weeks", "week 5", "weeks 3-5", "this range" or "all". Leave out for the whole project.' },
          since: { type: 'string', description: 'Instead of period: first day, YYYY-MM-DD.' },
          until: { type: 'string', description: 'Instead of period: last day, YYYY-MM-DD.' },
          members: { type: 'array', items: { type: 'string' }, description: 'Names to return. Leave out for everyone.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_info',
      description: 'Team members with role and skills, and the dates of every week. Only for questions about who is on the team or when a week was.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const CHAT_SYSTEM = `You answer questions about how work is shared in a student team project (ViCollab).
- You know no numbers yourself. For any number, call score_contributions once (with a period such as "Sprint 1", "last 4 weeks" or "week 5") and quote its numbers exactly. Never calculate new numbers.
- Score = 0.6 x commit share + 0.4 x lines share.
- The tool result has "facts": limit, ranking, topBottom, equalShare, inactive and balance. For any comparison, ranking, most or least, above or below, inactive or balance question, repeat the matching fact. Never compare or calculate numbers yourself.
- If a question needs a comparison that is not in the facts, say you can't answer that precisely. Don't guess.
- Answer in 1 to 3 short plain sentences, using people's names. Only answer about this team.`;

function projectInfo() {
  return {
    members: mock.members.map(({ name, role, skills }) => ({ name, role, skills })),
    weeks: weeks(),
  };
}

// "Sprint 1", "last 4 weeks", "week 5", "weeks 3-5", "this range", "all" -> { since, until }, or null
function resolvePeriod(period, context = {}) {
  const p = String(period).trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  const wk = weeks();
  const span = (a, b) => (a >= 1 && b >= a && b <= wk.length ? { since: wk[a - 1].since, until: wk[b - 1].until } : null);
  if (/^(all|all \d+ weeks|all weeks|whole project|the whole project|project|all time)$/.test(p)) return span(1, wk.length);
  if (/^(this|current|selected) (range|period)$/.test(p)) return context.since && context.until ? { since: context.since, until: context.until } : null;
  let m = p.match(/^last (\d+) weeks?$/);
  if (m) return span(wk.length - Number(m[1]) + 1, wk.length);
  m = p.match(/^sprint (\d+)$/); // two-week sprints, as in the "Sprint 1 (weeks 1-2)" preset
  if (m) return span(2 * m[1] - 1, 2 * m[1]);
  m = p.match(/^weeks? (\d+)(?: ?(?:-|to|and) ?(\d+))?$/);
  if (m) return span(Number(m[1]), Number(m[2] || m[1]));
  return null;
}

// only what an answer needs: no commits, no skipped counts, names instead of logins
function scoreTool(args, repo, context) {
  const { period, members } = args || {};
  let { since, until } = args || {};
  if (period) {
    const r = resolvePeriod(period, context);
    if (!r) return { error: `Unknown period ${JSON.stringify(period)}. Use e.g. "Sprint 1", "last 4 weeks", "week 5", "weeks 3-5", "this range" or "all", or since/until dates.` };
    ({ since, until } = r);
  }
  let wanted = null;
  if (members !== undefined && members !== null) {
    if (!Array.isArray(members)) return { error: '"members" must be a list of names' };
    wanted = members.map((m) => ({ asked: m, found: findMember(m) }));
    const unknown = wanted.filter((w) => !w.found).map((w) => w.asked);
    if (unknown.length) return { error: `Unknown member(s): ${unknown.join(', ')}. Members are: ${mock.members.map((m) => m.name).join(', ')}` };
  }
  try {
    const commits = repoCommits(repo);
    const r = scoreContributions({ commits, members: logins, since: since || undefined, until: until || undefined });
    const range = { since: since || mock.range.start, until: until || mock.range.end };
    const { team, rows, facts } = teamFacts(r, commits, range);
    const keep = wanted ? new Set(wanted.map((w) => w.found.login)) : null;
    return {
      period: range,
      team,
      members: rows.filter((m) => !keep || keep.has(m.login)).map(({ login, ...row }) => row),
      facts, // always about the whole team, even when only some members were asked for
      warnings: r.warnings.map((w) => logins.reduce((t, l) => t.split(l).join(findMember(l).name), w)),
    };
  } catch (err) {
    if (err instanceof ScoringInputError) return { error: err.message };
    throw err;
  }
}

/* ---------- comparisons for the chat, worked out here so the model never has to ---------- */
// "balanced" = nobody above the limit, everyone committed, and every score within
// half an equal share of it (12.5 to 37.5 points for 4 people)
const BALANCE_BAND = 0.5;
const round1 = (n) => Math.round(n * 10) / 10;
const listNames = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const isAre = (list) => (list.length === 1 ? 'is' : 'are');

// weeks that overlap the range, with each member's scored commits in them
function periodWeeks({ since, until }) {
  return weeks().filter((w) => w.until >= since && w.since <= until);
}

function teamFacts(result, commits, range) {
  const size = result.members.length;
  const equal = round1(100 / size);
  const band = round1(equal * BALANCE_BAND);
  const inPeriod = periodWeeks(range);
  const rows = result.members.map((m) => {
    const mine = scoredCommits(commits, m.author, range.since, range.until);
    const inactiveWeeks = inPeriod.filter((w) => !mine.some((c) => c.date.slice(0, 10) >= w.since && c.date.slice(0, 10) <= w.until)).map((w) => w.week);
    return {
      login: m.author,
      name: findMember(m.author).name,
      commits: m.commits, linesChanged: m.linesChanged, commitShare: m.commitShare, linesShare: m.linesShare, score: m.score,
      rank: 1 + result.members.filter((o) => o.score > m.score).length, // ties share a rank
      aboveLimit: size >= 2 && m.score > DOMINANT_LIMIT, // same rule as the scoring warning
      diffFromEqualShare: round1(m.score - 100 / size),
      inactiveWeeks,
    };
  });
  const scores = rows.map((m) => m.score);
  const max = Math.max(...scores), min = Math.min(...scores);
  const top = rows.filter((m) => m.score === max), bottom = rows.filter((m) => m.score === min);
  const over = rows.filter((m) => m.aboveLimit), idle = rows.filter((m) => m.commits === 0);
  const far = rows.filter((m) => Math.abs(m.diffFromEqualShare) > band);
  const balanced = !over.length && !idle.length && !far.length;
  const names = (list) => listNames(list.map((m) => m.name));
  const weekList = (w) => (w.length === 1 ? `week ${w[0]}` : `weeks ${listNames(w.map(String))}`);

  const facts = {
    limit: over.length
      ? `${listNames(over.map((m) => `${m.name} (score ${m.score})`))} ${isAre(over)} above the ${DOMINANT_LIMIT}% limit.`
      : `Nobody on the team is above the ${DOMINANT_LIMIT}% limit. The highest score is ${max}.`,
    ranking: `Ranking by score: ${rows.map((m) => `${m.rank}. ${m.name} (${m.score})`).join(', ')}.`,
    topBottom: max === min
      ? `Everyone has the same score (${max}).`
      : `Highest score: ${names(top)} (${max}). Lowest score: ${names(bottom)} (${min}).`,
    equalShare: `An equal share would be ${equal} points each. ${rows.map((m) => (m.diffFromEqualShare === 0
      ? `${m.name} is exactly on it`
      : `${m.name} is ${Math.abs(m.diffFromEqualShare)} ${m.diffFromEqualShare > 0 ? 'above' : 'below'} it`)).join(', ')}.`,
    inactive: (() => {
      const quiet = rows.filter((m) => m.inactiveWeeks.length), busy = rows.filter((m) => !m.inactiveWeeks.length);
      const parts = quiet.map((m) => (m.inactiveWeeks.length === inPeriod.length
        ? `${m.name} made no commits in any of the ${inPeriod.length} weeks`
        : `${m.name} made no commits in ${weekList(m.inactiveWeeks)}`));
      if (busy.length) parts.push(`${names(busy)} committed every week`);
      return `This period has ${inPeriod.length} week${inPeriod.length === 1 ? '' : 's'}. ${parts.join('; ')}.`;
    })(),
    balance: balanced
      ? `The work is balanced: nobody is above the ${DOMINANT_LIMIT}% limit, everyone made commits, and every score is within ${band} points of an equal share of ${equal}.`
      : `The work is not balanced: ${[
        over.length ? `${names(over)} ${isAre(over)} above the ${DOMINANT_LIMIT}% limit` : '',
        idle.length ? `${names(idle)} made no commits` : '',
        far.length ? `${names(far)} ${isAre(far)} more than ${band} points away from an equal share of ${equal}` : '',
      ].filter(Boolean).join('; ')}.`,
  };
  const team = {
    totalCommits: result.team.totalCommits, totalLinesChanged: result.team.totalLinesChanged,
    size, weeksInPeriod: inPeriod.length, equalShare: equal,
    top: { names: top.map((m) => m.name), score: max },
    bottom: { names: bottom.map((m) => m.name), score: min },
    balanced, dominanceLimitPercent: DOMINANT_LIMIT,
  };
  return { team, rows, facts };
}

function runTool(call, repo, context) {
  let args = call.arguments;
  if (typeof args === 'string') {
    try { args = args.trim() ? JSON.parse(args) : {}; } catch { return { args: null, result: { error: 'Tool arguments were not valid JSON' } }; }
  }
  if (call.name === 'get_project_info') return { args, result: projectInfo() };
  if (call.name === 'score_contributions') return { args, result: scoreTool(args, repo, context) };
  return { args, result: { error: `Unknown tool ${JSON.stringify(call.name)}` } };
}

const CHAT_OPTIONS = { think: false, maxTokens: 300 };

// message: the question; history: earlier [{ role: user|assistant, content }];
// context: { since, until } the dashboard is showing. Returns { reply, sources, grounded }.
// onEvent (streaming) gets { type: 'tool' | 'delta' | 'reset' } as things happen.
// strict: an answer that is still ungrounded after one correction throws (JSON API, 502);
// when streaming it is returned with grounded: false so the page can show it with a warning.
async function chatAnswer(ai, { message, history = [], context = {}, repo = DEFAULT_REPO }, { onEvent, strict = true } = {}) {
  repoCommits(repo); // unknown repo is a 400 before any model call
  const view = context.since && context.until ? `\nThe dashboard is showing ${context.since} to ${context.until}; "this range" means that.` : '';
  const messages = [{ role: 'system', content: CHAT_SYSTEM + view }, ...history, { role: 'user', content: message }];
  // numbers the user gave us are fine to repeat; the rest must come from tools
  const allowed = collectNumbers([message, context.since || '', context.until || '']);
  const sources = [];
  let toolRounds = 0, toolsWorked = false, corrected = false;

  for (let turn = 0; turn < 4; turn++) {
    // one tool round for a simple question: once a call worked, the next request offers no tools,
    // so the model has to answer. If every call failed, it gets one more try.
    const offerTools = !toolsWorked && toolRounds < 2;
    let streamed = false;
    const onDelta = onEvent ? (text) => { streamed = true; onEvent({ type: 'delta', text }); } : undefined;
    const reply = await ai.chat(messages, { ...CHAT_OPTIONS, tools: offerTools ? CHAT_TOOLS : undefined, onDelta });

    if (reply.toolCalls && reply.toolCalls.length) {
      if (streamed) onEvent({ type: 'reset' });
      if (!offerTools) throw new AIOutputError('the model asked for a tool after it already had the data');
      toolRounds++;
      messages.push(reply.message);
      reply.toolCalls.forEach((call, i) => {
        const { args, result } = runTool(call, repo, context);
        collectNumbers(result, allowed);
        if (!result.error) toolsWorked = true;
        const source = { tool: call.name, args, ok: !result.error };
        sources.push(source);
        if (onEvent) onEvent({ type: 'tool', ...source });
        messages.push({ role: 'tool', tool_call_id: call.id || `call_${turn}_${i}`, content: JSON.stringify(result) });
      });
      continue;
    }

    const answer = (reply.content || '').trim();
    const bad = answer ? ungrounded(answer, allowed) : [];
    if (answer && !bad.length) return { reply: answer, sources, grounded: true };
    const problem = answer ? `numbers not in any tool result: ${bad.join(', ')}` : 'empty answer';
    if (corrected) {
      if (strict || !answer) throw new AIOutputError(`chat answer could not be grounded (${problem})`);
      return { reply: answer, sources, grounded: false, ungrounded: bad };
    }
    corrected = true;
    if (streamed) onEvent({ type: 'reset', reason: answer ? 'check-failed' : 'empty', numbers: bad });
    messages.push(reply.message || { role: 'assistant', content: answer }, {
      role: 'user',
      content: answer
        ? `Your answer used numbers that are not in any tool result: ${bad.join(', ')}. Quote numbers exactly as the tools returned them and don't calculate new ones. Answer the question again.`
        : 'Your answer was empty. Answer the question again.',
    });
  }
  throw new AIOutputError('the model kept calling tools without answering');
}

/* ---------- JSON answers: our own check, with one retry that says what was wrong ---------- */
// options go to completeJSON (e.g. a temperature for Regenerate)
async function askJSON(ai, messages, check, options) {
  let problem;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await ai.completeJSON(messages, options);
      problem = check(data);
      if (!problem) return data;
    } catch (err) {
      if (!(err instanceof AIOutputError)) throw err;
      problem = err.message;
    }
    messages = [...messages, { role: 'user', content: `Your last reply was not usable: ${problem}. Reply again with only the JSON object described above.` }];
  }
  throw new AIOutputError(problem);
}

/* ---------- 2. commit classification (context only, never part of the score) ---------- */
const TYPES = ['feat', 'fix', 'test', 'docs', 'chore', 'refactor'];
const MAX_BATCH = 30;
const CACHE_MAX = 5000;
const typeCache = new Map(); // sha -> { type, trivial }

const CLASSIFY_SYSTEM = `You label git commit messages. For each commit decide:
- type: one of ${TYPES.join(', ')}. Go by what the change does, not only its prefix:
  feat = new behaviour or UI, fix = bug fix, test = tests only, docs = documentation only,
  chore = tooling, dependencies, config, refactor = restructuring or performance work with no new behaviour.
  "perf:" is refactor. "style:" that changes how the UI looks is feat; pure code formatting is chore.
- trivial: true only for tiny or mechanical changes (typo, formatting, version bump, rename), otherwise false.
Reply with JSON only: {"commits":[{"id":1,"type":"feat","trivial":false}, ...]} with one entry for every id you were given.`;

function checkLabels(data, n) {
  if (!data || !Array.isArray(data.commits)) return 'expected an object with a "commits" array';
  if (data.commits.length !== n) return `expected ${n} entries, got ${data.commits.length}`;
  const seen = new Set();
  for (const r of data.commits) {
    if (!r || !Number.isInteger(r.id) || r.id < 1 || r.id > n) return `bad id ${JSON.stringify(r && r.id)}`;
    if (seen.has(r.id)) return `id ${r.id} appears twice`;
    seen.add(r.id);
    if (!TYPES.includes(r.type)) return `id ${r.id} has type ${JSON.stringify(r.type)}, it must be one of ${TYPES.join(', ')}`;
    if (typeof r.trivial !== 'boolean') return `id ${r.id} needs "trivial": true or false`;
  }
  return null;
}

// even batches of at most 30, e.g. 94 commits -> 24 + 24 + 23 + 23
function batches(list) {
  const count = Math.ceil(list.length / MAX_BATCH), out = [];
  for (let i = 0, start = 0; i < count; i++) {
    const size = Math.ceil((list.length - start) / (count - i));
    out.push(list.slice(start, start + size));
    start += size;
  }
  return out;
}

function remember(sha, label) {
  if (typeCache.size >= CACHE_MAX) typeCache.delete(typeCache.keys().next().value);
  typeCache.set(sha, label);
}

// the model sees short ids, not 40-character shas it could mistype
async function classifyBatch(ai, batch) {
  const messages = [
    { role: 'system', content: CLASSIFY_SYSTEM },
    { role: 'user', content: JSON.stringify({ commits: batch.map((c, i) => ({ id: i + 1, message: c.message.slice(0, 300) })) }) },
  ];
  const data = await askJSON(ai, messages, (d) => checkLabels(d, batch.length));
  data.commits.forEach((r) => remember(batch[r.id - 1].sha, { type: r.type, trivial: r.trivial }));
}

// commits: [{ sha, message }]. Returns { results: [{ sha, type, trivial }], cached, classified }
async function classifyCommits(ai, commits) {
  const unique = [...new Map(commits.map((c) => [c.sha, c])).values()];
  const todo = unique.filter((c) => !typeCache.has(c.sha));
  for (const batch of batches(todo)) await classifyBatch(ai, batch); // one at a time: Ollama runs them in turn anyway
  return {
    results: unique.map((c) => ({ sha: c.sha, ...typeCache.get(c.sha) })),
    cached: unique.length - todo.length,
    classified: todo.length,
  };
}

// counts per type for these commits, or null unless every one has been classified already
function cachedTypeCounts(commits) {
  if (!commits.length || !commits.every((c) => typeCache.has(c.sha))) return null;
  const counts = Object.fromEntries(TYPES.map((t) => [t, 0]));
  let trivial = 0;
  commits.forEach((c) => { const l = typeCache.get(c.sha); counts[l.type]++; if (l.trivial) trivial++; });
  return { ...counts, trivial };
}

const clearTypeCache = () => typeCache.clear();

/* ---------- facts for summaries and explanations, all computed here, never by the model ---------- */
const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
// scored commits (no merges, no repeated sha) per member, inside the range, like the member page
function scoredCommits(commits, login, since, until) {
  const from = since ? Date.parse(since) : -Infinity;
  const to = until ? Date.parse(until) + (isDateOnly(until) ? DAY - 1 : 0) : Infinity;
  const seen = new Set();
  return commits.filter((c) => {
    if (c.author !== login || isMerge(c) || seen.has(c.sha)) return false;
    seen.add(c.sha);
    const t = Date.parse(c.date);
    return t >= from && t <= to;
  });
}

// distinct messages with how often each was used, most used first
function messageCounts(list, limit = 12) {
  const counts = new Map();
  list.forEach((c) => counts.set(c.message, (counts.get(c.message) || 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([message, count]) => ({ message, count }));
}

function scoreRange({ since, until, repo }) {
  const commits = repoCommits(repo);
  const result = scoreContributions({ commits, members: logins, since: since || undefined, until: until || undefined });
  return { commits, result, range: { since: since || mock.range.start, until: until || mock.range.end } };
}

function memberFacts(login, { since, until, repo }) {
  const who = mock.members.find((m) => m.login === login);
  if (!who) throw new AIRequestError(`No team member with the login ${JSON.stringify(login)}`, 404);
  const { commits, result, range } = scoreRange({ since, until, repo });
  const index = result.members.findIndex((m) => m.author === login);
  const me = result.members[index];
  const inRange = scoredCommits(commits, login, since, until);
  const all = scoredCommits(commits, login);
  const weekly = weeks().map((w) => ({
    week: w.week,
    commits: all.filter((c) => c.date.slice(0, 10) >= w.since && c.date.slice(0, 10) <= w.until).length,
    inSelectedRange: w.until >= range.since && w.since <= range.until,
  }));
  return {
    member: { login, name: who.name, role: who.role, skills: who.skills },
    range,
    stats: {
      score: me.score, rank: index + 1, teamSize: result.members.length,
      commits: me.commits, commitShare: me.commitShare, linesChanged: me.linesChanged, linesShare: me.linesShare,
      linesAdded: inRange.reduce((n, c) => n + c.additions, 0),
      linesDeleted: inRange.reduce((n, c) => n + c.deletions, 0),
    },
    weeklyCommits: weekly,
    commitMessages: messageCounts(inRange),
    commitTypes: cachedTypeCounts(inRange),
    warnings: result.warnings.filter((w) => w.startsWith(login + ' ')),
    dominanceLimitPercent: DOMINANT_LIMIT,
  };
}

const sentences = (text) => String(text).trim().split(/(?<=[.!?])\s+(?=["'(A-Z0-9])/).filter(Boolean).length;

// a short text field with a sentence range and only grounded numbers; returns a problem or null
function checkProse(text, field, allowed, [min, max]) {
  if (typeof text !== 'string' || !text.trim()) return `"${field}" must be text`;
  const n = sentences(text);
  if (n < min || n > max) return `"${field}" must be ${min} to ${max} sentences, it has ${n}`;
  const bad = ungrounded(text, allowed);
  if (bad.length) return `"${field}" uses numbers that are not in the data: ${bad.join(', ')}. Only use numbers from the data`;
  return null;
}

/* ---------- 3. member summary ---------- */
const SUMMARY_SYSTEM = `You write a short summary of one student's contribution to a team project, for their teacher.
You get JSON facts that were computed by the scoring module. Rules:
- 2 or 3 sentences, plain text, neutral and fair. Use the person's first name.
- Only use numbers that appear in the facts, exactly as given. Don't calculate new ones.
- Mention their score and share, and the trend in weeklyCommits (e.g. steady, early then quiet, growing).
- Compare their role and skills with what their commit messages are about. If they clearly don't match,
  say so in the summary and set roleMismatch to true; otherwise set it to false.
- The summary is prose for a person: never write field names such as "roleMismatch" or "true"/"false" in it.
Reply with JSON only: {"summary": "...", "roleMismatch": false}`;

/* ---------- saved summaries and explanations ---------- */
// Same member (or team), repo and range -> the same text, so a page revisit is instant and the
// wording doesn't change. regenerate skips the saved text and saves the new one. Failures are not saved.
const TEXT_CACHE_MAX = 500;
const textCache = new Map(); // key -> { value, generatedAt }

async function remembered(key, regenerate, make) {
  if (!regenerate && textCache.has(key)) {
    const hit = textCache.get(key);
    return { ...hit.value, cached: true, generatedAt: hit.generatedAt };
  }
  const value = await make();
  const generatedAt = new Date().toISOString();
  textCache.delete(key);
  if (textCache.size >= TEXT_CACHE_MAX) textCache.delete(textCache.keys().next().value);
  textCache.set(key, { value, generatedAt });
  return { ...value, cached: false, generatedAt };
}
const clearTextCache = () => textCache.clear();

async function memberSummary(ai, { login, since, until, repo = DEFAULT_REPO, regenerate = false }) {
  const facts = memberFacts(login, { since, until, repo });
  const key = ['summary', repo, login, facts.range.since, facts.range.until].join('|');
  return remembered(key, regenerate, () => writeSummary(ai, login, facts, regenerate));
}

// first text at temperature 0 (stable); Regenerate at 0.7, or it would come back word for word the same
const REGENERATE = { temperature: 0.7 };

async function writeSummary(ai, login, facts, regenerate) {
  const allowed = collectNumbers(facts);
  const messages = [{ role: 'system', content: SUMMARY_SYSTEM }, { role: 'user', content: JSON.stringify(facts) }];
  const data = await askJSON(ai, messages, (d) => {
    if (!d || typeof d !== 'object') return 'expected a JSON object';
    // the model sometimes sends "false" as a string (seen with Regenerate's higher temperature)
    if (d.roleMismatch === 'true' || d.roleMismatch === 'false') d.roleMismatch = d.roleMismatch === 'true';
    if (typeof d.roleMismatch !== 'boolean') return '"roleMismatch" must be true or false';
    if (/role\s*mismatch\s*:|\b(true|false)\b/i.test(d.summary || '')) return 'the summary must not contain field names or true/false, write it as prose';
    return checkProse(d.summary, 'summary', allowed, [2, 3]);
  }, regenerate ? REGENERATE : undefined);
  return { login, range: facts.range, summary: data.summary.trim(), roleMismatch: data.roleMismatch, stats: facts.stats };
}

/* ---------- 4. why the dominance warning fired, and where the score may mislead ---------- */
const EXPLAIN_SYSTEM = `A team dashboard shows a warning because one member has more than the dominance limit of the contribution score.
Score = 0.6 x commit share + 0.4 x lines share. You get JSON facts computed by the scoring module.
- explanation: 1 or 2 sentences saying why this member is above the limit (more commits, bigger commits, or both).
- caveats: 0 to 3 short sentences on where the score may mislead here, e.g. docs or test work producing few lines,
  scaffolding or generated code producing many lines, or commits counted equally whatever their size. Only include caveats the facts support.
Only use numbers that appear in the facts, exactly as given. Don't calculate new ones. Use first names.
Reply with JSON only: {"explanation": "...", "caveats": ["..."]}`;

async function explainWarning(ai, { since, until, repo = DEFAULT_REPO, regenerate = false }) {
  const { commits, result, range } = scoreRange({ since, until, repo });
  const top = result.members.length >= 2 ? result.members.find((m) => m.score > DOMINANT_LIMIT) : null;
  if (!top) throw new AIRequestError('There is no dominance warning for this range, so there is nothing to explain');
  const key = ['explain', repo, range.since, range.until].join('|');
  return remembered(key, regenerate, () => writeExplanation(ai, { commits, result, range, top, since, until }, regenerate));
}

async function writeExplanation(ai, { commits, result, range, top, since, until }, regenerate) {
  const facts = {
    warning: result.warnings.find((w) => w.startsWith(top.author + ' ')),
    dominanceLimitPercent: DOMINANT_LIMIT,
    range,
    team: result.team,
    members: result.members.map((m) => {
      const mine = scoredCommits(commits, m.author, since, until);
      const who = findMember(m.author);
      return {
        login: m.author, name: who.name, role: who.role,
        commits: m.commits, linesChanged: m.linesChanged, commitShare: m.commitShare, linesShare: m.linesShare, score: m.score,
        avgLinesPerCommit: m.commits ? Math.round((m.linesChanged / m.commits) * 10) / 10 : 0,
        commitMessages: messageCounts(mine, 6),
        commitTypes: cachedTypeCounts(mine),
      };
    }),
  };
  const allowed = collectNumbers(facts);
  const messages = [{ role: 'system', content: EXPLAIN_SYSTEM }, { role: 'user', content: JSON.stringify(facts) }];
  const data = await askJSON(ai, messages, (d) => {
    if (!d || typeof d !== 'object') return 'expected a JSON object';
    const problem = checkProse(d.explanation, 'explanation', allowed, [1, 2]);
    if (problem) return problem;
    if (!Array.isArray(d.caveats) || d.caveats.length > 3) return '"caveats" must be a list of 0 to 3 sentences';
    for (const c of d.caveats) {
      const p = checkProse(c, 'caveats', allowed, [1, 2]);
      if (p) return p;
    }
    return null;
  }, regenerate ? REGENERATE : undefined);
  return { member: top.author, range, warning: facts.warning, explanation: data.explanation.trim(), caveats: data.caveats.map((c) => c.trim()) };
}

module.exports = {
  AIRequestError, DEFAULT_REPO, CHAT_TOOLS, TYPES, MAX_BATCH,
  chatAnswer, runTool, resolvePeriod, ungrounded, collectNumbers, findMember, repoCommits,
  askJSON, classifyCommits, cachedTypeCounts, clearTypeCache,
  memberFacts, memberSummary, explainWarning, clearTextCache, teamFacts, BALANCE_BAND,
};
