// Tests for the faster chat: thinking off, keep_alive, max_tokens, one tool call,
// short tool results, and streaming (client parser and the NDJSON endpoint). No model needed.
const request = require('supertest');
const app = require('../src/app');
const mock = require('../public/app/mock-data.js');
const { scoreContributions } = require('../src/scoring');
const { createAiClient, AIUnavailableError } = require('../src/ai');
const { fakeAI, say, callTool, down } = require('./helpers/fake-ai');

const CHAT = '/api/ai/chat';
const logins = mock.members.map((m) => m.login);
const main = mock.repos.find((r) => r.fullName === 'mrinalg297/vicollab').commits;
const sprint1 = mock.range.presets.find((p) => p.id === 'sprint1');
const realScore = (since, until) => scoreContributions({ members: logins, commits: main, since, until });
const kabir = realScore(sprint1.since, sprint1.until).members.find((m) => m.author === 'kabir-s');
const use = (fake) => { app.locals.ai = fake; return fake; };
const lastToolResult = (call) => JSON.parse(call.messages.filter((m) => m.role === 'tool').pop().content);

describe('AI client speed options and streaming', () => {
  // a fetch whose body is the given server-sent-event chunks
  const sse = (chunks) => {
    const f = async (url, init) => {
      f.body = JSON.parse(init.body);
      return { ok: true, status: 200, body: (async function* () { for (const c of chunks) yield new TextEncoder().encode(c); })() };
    };
    return f;
  };
  const data = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;

  test('AI every request keeps the model loaded (keep_alive, default 30m, AI_KEEP_ALIVE)', async () => {
    const fetch = sse([data({ content: 'x' }), 'data: [DONE]\n\n']);
    await createAiClient({ fetch }).chat([], { onDelta: () => {} });
    expect(fetch.body.keep_alive).toBe('30m');
    const saved = process.env.AI_KEEP_ALIVE;
    process.env.AI_KEEP_ALIVE = '2h';
    await createAiClient({ fetch }).chat([], { onDelta: () => {} });
    if (saved === undefined) delete process.env.AI_KEEP_ALIVE; else process.env.AI_KEEP_ALIVE = saved;
    expect(fetch.body.keep_alive).toBe('2h');
  });

  test('AI maxTokens is sent as max_tokens, and onDelta turns streaming on', async () => {
    const fetch = sse([data({ content: 'x' })]);
    await createAiClient({ fetch }).chat([], { maxTokens: 300, think: false, onDelta: () => {} });
    expect(fetch.body).toMatchObject({ max_tokens: 300, stream: true, think: false, reasoning_effort: 'none' });
  });

  test('AI streamed text reaches onDelta piece by piece, even when a chunk splits a line', async () => {
    const all = data({ role: 'assistant', content: 'Kabir ' }) + data({ content: 'has ' }) + data({ content: '62.2%.' }) + 'data: [DONE]\n\n';
    const fetch = sse([all.slice(0, 50), all.slice(50, 130), all.slice(130)]);
    const pieces = [];
    const out = await createAiClient({ fetch }).chat([], { onDelta: (t) => pieces.push(t) });
    expect(pieces).toEqual(['Kabir ', 'has ', '62.2%.']);
    expect(out).toMatchObject({ content: 'Kabir has 62.2%.', toolCalls: [] });
  });

  test('AI streamed tool calls are put back together (whole like Ollama, or in pieces like OpenAI)', async () => {
    const fetch = sse([
      data({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'score_contributions', arguments: '{"period":' } }] }),
      data({ tool_calls: [{ index: 0, function: { arguments: '"Sprint 1"}' } }] }),
      data({ tool_calls: [{ index: 1, id: 'c2', type: 'function', function: { name: 'get_project_info', arguments: '{}' } }] }),
    ]);
    const out = await createAiClient({ fetch }).chat([], { onDelta: () => {} });
    expect(out.toolCalls).toEqual([
      { id: 'c1', name: 'score_contributions', arguments: '{"period":"Sprint 1"}' },
      { id: 'c2', name: 'get_project_info', arguments: '{}' },
    ]);
    expect(out.message.tool_calls).toHaveLength(2);
  });

  test('AI a stream that breaks off gives AIUnavailableError', async () => {
    const fetch = async () => ({
      ok: true, status: 200,
      body: (async function* () { yield new TextEncoder().encode(data({ content: 'Hi' })); throw new Error('socket hang up'); })(),
    });
    await expect(createAiClient({ fetch }).chat([], { onDelta: () => {} })).rejects.toThrow(AIUnavailableError);
  });
});

describe('AI chat: one tool call and short tool results', () => {
  test('AI chat a simple question is one tool call, and the answer request offers no tools', async () => {
    const ai = use(fakeAI({ chat: [callTool('score_contributions', { period: 'Sprint 1' }), say(`Kabir scored ${kabir.score}.`)] }));
    const res = await request(app).post(CHAT).send({ message: 'Kabir in Sprint 1?' });
    expect(res.status).toBe(200);
    expect(ai.calls.chat).toHaveLength(2);
    expect(ai.calls.chat[1].options.tools).toBeUndefined();
    expect(lastToolResult(ai.calls.chat[1]).period).toEqual({ since: sprint1.since, until: sprint1.until });
  });

  test('AI chat a tool call after the data arrived is rejected (502)', async () => {
    use(fakeAI({ chat: [callTool('score_contributions', {}), callTool('score_contributions', { period: 'week 2' }, 'c2')] }));
    expect((await request(app).post(CHAT).send({ message: 'Kabir?' })).status).toBe(502);
  });

  // weeks with no commits, straight from the weekly counts in mock-data.js
  // kabir-s [6,7,4,2,1,0,0,1,0,0,0,0], isha-rao [0,1,0,2,3,0,4,0,2,1,0,3]
  test('AI chat facts: rank, aboveLimit, difference from an equal share and inactive weeks per member', async () => {
    const ai = use(fakeAI({ chat: [callTool('score_contributions', { period: 'all' }), say('Done.')] }));
    await request(app).post(CHAT).send({ message: 'Scores?' });
    const tool = lastToolResult(ai.calls.chat[1]);
    const truth = realScore('2026-07-27', '2026-10-18').members;
    expect(tool.members.map((m) => [m.name, m.rank, m.aboveLimit, m.diffFromEqualShare, m.inactiveWeeks])).toEqual([
      ['Aarav Mehta', 1, false, Math.round((truth[0].score - 25) * 10) / 10, []],
      ['Meera Iyer', 2, false, Math.round((truth[1].score - 25) * 10) / 10, []],
      ['Kabir Singh', 3, false, Math.round((truth[2].score - 25) * 10) / 10, [6, 7, 9, 10, 11, 12]],
      ['Isha Rao', 4, false, Math.round((truth[3].score - 25) * 10) / 10, [1, 3, 6, 8, 11]],
    ]);
    expect(tool.team).toMatchObject({
      size: 4, weeksInPeriod: 12, equalShare: 25, balanced: false, dominanceLimitPercent: 60,
      top: { names: ['Aarav Mehta'], score: truth[0].score }, bottom: { names: ['Isha Rao'], score: truth[3].score },
    });
  });

  test('AI chat facts are plain sentences about the whole team, even when one member is asked about', async () => {
    const last4 = realScore('2026-09-21', '2026-10-18').members;
    const ai = use(fakeAI({ chat: [callTool('score_contributions', { period: 'last 4 weeks', members: ['Meera'] }), say('Done.')] }));
    await request(app).post(CHAT).send({ message: 'Meera?' });
    const tool = lastToolResult(ai.calls.chat[1]);
    expect(tool.members.map((m) => m.name)).toEqual(['Meera Iyer']);
    expect(Object.keys(tool.facts)).toEqual(['limit', 'ranking', 'topBottom', 'equalShare', 'inactive', 'balance']);
    expect(last4[0].score).toBeLessThan(60);
    expect(tool.facts.limit).toBe(`Nobody on the team is above the 60% limit. The highest score is ${last4[0].score}.`);
    expect(tool.facts.topBottom).toBe(`Highest score: Aarav Mehta (${last4[0].score}). Lowest score: Kabir Singh (0).`);
    expect(tool.facts.ranking).toMatch(/^Ranking by score: 1\. Aarav Mehta .*4\. Kabir Singh \(0\)\.$/);
    expect(tool.facts.inactive).toBe('This period has 4 weeks. Isha Rao made no commits in week 11; Kabir Singh made no commits in any of the 4 weeks; Aarav Mehta and Meera Iyer committed every week.');
    expect(tool.facts.balance).toMatch(/^The work is not balanced: Kabir Singh made no commits; .* more than 12\.5 points away from an equal share of 25\.$/);
    expect(tool.facts.equalShare).toMatch(/^An equal share would be 25 points each\. Aarav Mehta is [\d.]+ above it, .*Kabir Singh is 25 below it\.$/);
  });

  test('AI chat facts name the member above the limit (Sprint 1)', async () => {
    const ai = use(fakeAI({ chat: [callTool('score_contributions', { period: 'Sprint 1' }), say('Done.')] }));
    await request(app).post(CHAT).send({ message: 'Anyone above 60%?' });
    const tool = lastToolResult(ai.calls.chat[1]);
    expect(tool.facts.limit).toBe(`Kabir Singh (score ${kabir.score}) is above the 60% limit.`);
    expect(tool.members.filter((m) => m.aboveLimit).map((m) => m.name)).toEqual(['Kabir Singh']);
    expect(tool.facts.balance).toMatch(/^The work is not balanced: Kabir Singh is above the 60% limit;/);
  });

  test('AI chat facts: ties share a rank and are listed together; equal scores count as balanced', () => {
    const { teamFacts } = require('../src/ai-features');
    const c = (sha, author, date = '2026-07-28T10:00:00Z') => ({ sha, author, additions: 10, deletions: 0, date, message: 'feat: x' });
    const range = { since: '2026-07-27', until: '2026-08-02' }; // week 1 only
    const tie = scoreContributions({ members: logins, commits: [c('t1', 'aarav-m'), c('t2', 'meera-iyer')], ...range });
    let f = teamFacts(tie, [c('t1', 'aarav-m'), c('t2', 'meera-iyer')], range);
    expect(f.rows.map((m) => m.rank)).toEqual([1, 1, 3, 3]);
    expect(f.facts.topBottom).toBe('Highest score: Aarav Mehta and Meera Iyer (50). Lowest score: Isha Rao and Kabir Singh (0).'); // same order as the scoring module and the table
    expect(f.team.balanced).toBe(false);

    const all = logins.map((l, i) => c('e' + i, l));
    f = teamFacts(scoreContributions({ members: logins, commits: all, ...range }), all, range);
    expect(f.rows.map((m) => m.rank)).toEqual([1, 1, 1, 1]);
    expect(f.facts.topBottom).toBe('Everyone has the same score (25).');
    expect(f.team.balanced).toBe(true);
    expect(f.facts.balance).toBe('The work is balanced: nobody is above the 60% limit, everyone made commits, and every score is within 12.5 points of an equal share of 25.');
    expect(f.facts.inactive).toBe('This period has 1 week. Aarav Mehta, Isha Rao, Kabir Singh and Meera Iyer committed every week.'); // tied, so A-Z by login
  });

  test('AI chat repeating any fact word for word passes the number check first time', async () => {
    for (const period of ['all', 'last 4 weeks', 'Sprint 1', 'week 5']) {
      const facts = (m) => JSON.parse(m.filter((x) => x.role === 'tool').pop().content).facts;
      const ai = use(fakeAI({ chat: [callTool('score_contributions', { period }), (m) => say(Object.values(facts(m)).join(' '))] }));
      const res = await request(app).post(CHAT).send({ message: 'Tell me everything.' });
      expect(res.status).toBe(200);
      expect(ai.calls.chat).toHaveLength(2); // no correction round
    }
  });

  test('AI chat the system prompt says to repeat facts, never compare, and admit what it cannot answer', async () => {
    const ai = use(fakeAI({ chat: [say('Hello.')] }));
    await request(app).post(CHAT).send({ message: 'Hi' });
    const system = ai.calls.chat[0].messages[0].content;
    expect(system).toMatch(/repeat the matching fact/);
    expect(system).toMatch(/Never compare or calculate numbers yourself/);
    expect(system).toMatch(/can't answer that precisely/);
  });

  test('AI chat the tool result never contains commits and stays small', async () => {
    const ai = use(fakeAI({ chat: [callTool('score_contributions', {}), say('Done.')] }));
    await request(app).post(CHAT).send({ message: 'Scores?' });
    const sent = ai.calls.chat[1].messages.find((m) => m.role === 'tool').content;
    expect(sent).not.toContain(main[0].sha);
    expect(sent.length).toBeLessThan(2500);
  });

  test.each([
    ['Sprint 1', '2026-07-27', '2026-08-09'],
    ['last 4 weeks', '2026-09-21', '2026-10-18'],
    ['week 5', '2026-08-24', '2026-08-30'],
    ['weeks 3–5', '2026-08-10', '2026-08-30'],
    ['all', '2026-07-27', '2026-10-18'],
  ])('AI chat period %s is turned into dates by the server', async (period, since, until) => {
    const ai = use(fakeAI({ chat: [callTool('score_contributions', { period }), say('Done.')] }));
    await request(app).post(CHAT).send({ message: 'Scores?' });
    const tool = lastToolResult(ai.calls.chat[1]);
    expect(tool.period).toEqual({ since, until });
    expect(tool.team.totalCommits).toBe(realScore(since, until).team.totalCommits);
  });

  test('AI chat period "this range" uses the dashboard range; unknown periods are a tool error', async () => {
    let ai = use(fakeAI({ chat: [callTool('score_contributions', { period: 'this range' }), say('Done.')] }));
    await request(app).post(CHAT).send({ message: 'Scores?', context: { since: '2026-08-03', until: '2026-08-16' } });
    expect(lastToolResult(ai.calls.chat[1]).period).toEqual({ since: '2026-08-03', until: '2026-08-16' });

    ai = use(fakeAI({ chat: [callTool('score_contributions', { period: 'Sprint 9' }), callTool('score_contributions', { since: 'last week' }, 'c2'), say('Which dates?')] }));
    await request(app).post(CHAT).send({ message: 'Scores?' });
    const errors = ai.calls.chat[2].messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content).error);
    expect(errors).toEqual([expect.stringMatching(/Unknown period/), expect.stringMatching(/since/)]);
  });
});

describe('POST /api/ai/chat with stream: true', () => {
  // collect the NDJSON body as text, then as a list of events
  const events = (req) => req.buffer(true).parse((res, cb) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => cb(null, text));
  });
  const parse = (res) => res.body.trim().split('\n').map((l) => JSON.parse(l));

  test('AI stream sends the tool call, the words as they come, then the checked answer', async () => {
    use(fakeAI({ chat: [callTool('score_contributions', { period: 'Sprint 1' }), say(`Kabir Singh has ${kabir.score}% of the score.`)] }));
    const res = await events(request(app).post(CHAT).send({ message: 'Who did the most in Sprint 1?', stream: true }));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/x-ndjson/);
    const ev = parse(res);
    expect(ev[0]).toEqual({ type: 'tool', tool: 'score_contributions', args: { period: 'Sprint 1' }, ok: true });
    const deltas = ev.filter((e) => e.type === 'delta');
    expect(deltas.length).toBeGreaterThan(3);
    expect(deltas.map((e) => e.text).join('')).toBe(`Kabir Singh has ${kabir.score}% of the score.`);
    expect(ev.pop()).toMatchObject({ type: 'done', reply: `Kabir Singh has ${kabir.score}% of the score.`, grounded: true, model: 'fake-model' });
  });

  test('AI stream a failed number check resets the text, retries once, then warns', async () => {
    use(fakeAI({ chat: [callTool('score_contributions', { period: 'Sprint 1' }), say('Kabir has 99.9%.'), say('Kabir has 88.8%.')] }));
    const ev = parse(await events(request(app).post(CHAT).send({ message: 'Kabir?', stream: true })));
    expect(ev.find((e) => e.type === 'reset')).toEqual({ type: 'reset', reason: 'check-failed', numbers: ['99.9'] });
    expect(ev.pop()).toMatchObject({ type: 'done', reply: 'Kabir has 88.8%.', grounded: false, ungrounded: ['88.8'] });
  });

  test('AI stream a corrected answer is shown as grounded', async () => {
    use(fakeAI({ chat: [callTool('score_contributions', { period: 'Sprint 1' }), say('Kabir has 99.9%.'), say(`Kabir has ${kabir.score}%.`)] }));
    const ev = parse(await events(request(app).post(CHAT).send({ message: 'Kabir?', stream: true })));
    expect(ev.pop()).toMatchObject({ type: 'done', grounded: true });
  });

  test('AI stream the JSON (non-stream) chat stays strict: same bad answers give 502', async () => {
    use(fakeAI({ chat: [callTool('score_contributions', { period: 'Sprint 1' }), say('Kabir has 99.9%.'), say('Kabir has 88.8%.')] }));
    expect((await request(app).post(CHAT).send({ message: 'Kabir?' })).status).toBe(502);
  });

  test('AI stream Ollama down before anything was sent is a plain 503', async () => {
    use(fakeAI({ chat: [down()] }));
    const res = await request(app).post(CHAT).send({ message: 'Who?', stream: true });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'AI unavailable' });
  });

  test('AI stream Ollama down halfway ends the stream with an error event', async () => {
    use(fakeAI({ chat: [callTool('score_contributions', {}), down()] }));
    const ev = parse(await events(request(app).post(CHAT).send({ message: 'Who?', stream: true })));
    expect(ev.pop()).toEqual({ type: 'error', status: 503, error: 'AI unavailable' });
  });

  test('AI stream a crash halfway is a generic error event without the message', async () => {
    use(fakeAI({ chat: [callTool('score_contributions', {}), new Error('secret detail')] }));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await events(request(app).post(CHAT).send({ message: 'Who?', stream: true }));
    spy.mockRestore();
    expect(parse(res).pop()).toEqual({ type: 'error', status: 500, error: 'Something went wrong on the server' });
    expect(res.body).not.toContain('secret');
  });

  test('AI stream bad input is still a 400 JSON error', async () => {
    const ai = use(fakeAI());
    for (const body of [{ message: 'Who?', stream: 'yes' }, { stream: true }]) {
      const res = await request(app).post(CHAT).send(body);
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(/json/);
    }
    expect(ai.calls.chat).toHaveLength(0);
  });
});
