// /api/ai/* endpoints. The client comes from req.app.locals.ai (tests put a fake there).
// Input is checked before the model is called, so a bad request is a 400 even with Ollama off.
const express = require('express');
const { ScoringInputError } = require('./scoring');
const { AIUnavailableError, AIOutputError } = require('./ai');
const features = require('./ai-features');

const router = express.Router();
const quiet = process.env.NODE_ENV === 'test';
const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;

function bodyOf(req, res, { optional = false } = {}) {
  if (req.body === undefined) {
    if (optional) return {};
    res.status(400).json({ error: 'No JSON body received. Send a JSON object with the header Content-Type: application/json' });
    return null;
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Request body must be a JSON object' });
    return null;
  }
  return req.body;
}

// one place that turns errors into status codes; null for anything unexpected
function errorReply(err) {
  if (err instanceof AIUnavailableError) {
    if (!quiet) console.warn(`AI unavailable: ${err.message}`);
    return { status: 503, error: 'AI unavailable' };
  }
  if (err instanceof AIOutputError) {
    if (!quiet) console.warn(`AI output rejected: ${err.message}`);
    return { status: 502, error: 'The AI returned an answer that could not be checked. Try again.' };
  }
  if (err instanceof features.AIRequestError) return { status: err.status, error: err.message };
  if (err instanceof ScoringInputError) return { status: 400, error: err.message };
  return null;
}

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    const reply = errorReply(err);
    if (!reply) return next(err);
    res.status(reply.status).json({ error: reply.error });
  }
};

const checkRepo = (repo) => (repo === undefined || isText(repo, 200) ? null : '"repo" must be a repository name');

router.post('/chat', handle(async (req, res) => {
  const body = bodyOf(req, res);
  if (!body) return;
  const { message, history = [], context = {}, repo, stream = false } = body;
  if (!isText(message, 1000)) return res.status(400).json({ error: '"message" must be a question of 1 to 1000 characters' });
  if (typeof stream !== 'boolean') return res.status(400).json({ error: '"stream" must be true or false' });
  if (!Array.isArray(history) || history.length > 20
    || !history.every((h) => h && ['user', 'assistant'].includes(h.role) && typeof h.content === 'string' && h.content.length <= 4000)) {
    return res.status(400).json({ error: '"history" must be up to 20 { role: "user" | "assistant", content } messages' });
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)
    || ['since', 'until'].some((k) => context[k] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(context[k]))) {
    return res.status(400).json({ error: '"context" must be { since, until } with YYYY-MM-DD dates' });
  }
  const bad = checkRepo(repo);
  if (bad) return res.status(400).json({ error: bad });
  const ai = req.app.locals.ai;
  const question = { message: message.trim(), history: history.map(({ role, content }) => ({ role, content })), context, repo };
  if (!stream) {
    const out = await features.chatAnswer(ai, question);
    return res.json({ ...out, model: ai.model });
  }

  // Streaming: one JSON event per line (tool, delta, reset, then done or error).
  // Headers go out with the first event, so a failure before that (e.g. Ollama down)
  // is still a normal JSON error with the right status.
  let started = false;
  const send = (event) => {
    if (!started) {
      started = true;
      res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
    }
    res.write(JSON.stringify(event) + '\n');
  };
  try {
    const out = await features.chatAnswer(ai, question, { onEvent: send, strict: false });
    send({ type: 'done', ...out, model: ai.model });
  } catch (err) {
    if (!started) throw err;
    const reply = errorReply(err);
    if (!reply) console.error(err);
    send({ type: 'error', ...(reply || { status: 500, error: 'Something went wrong on the server' }) });
  }
  res.end();
}));

router.post('/classify', handle(async (req, res) => {
  const body = bodyOf(req, res);
  if (!body) return;
  const { commits } = body;
  if (!Array.isArray(commits) || commits.length === 0 || commits.length > 300) {
    return res.status(400).json({ error: '"commits" must be a list of 1 to 300 { sha, message } objects' });
  }
  const bad = commits.findIndex((c) => !c || !isText(c.sha, 64) || typeof c.message !== 'string' || c.message.length > 2000);
  if (bad !== -1) return res.status(400).json({ error: `commit ${bad} needs a "sha" (up to 64 characters) and a "message" (text)` });
  const out = await features.classifyCommits(req.app.locals.ai, commits.map(({ sha, message }) => ({ sha, message })));
  res.json({ ...out, model: req.app.locals.ai.model });
}));

// since/until/repo are optional; leaving them out means the whole project on the main repo.
// regenerate: true skips the saved text for this member/team and range and writes a new one.
function rangeBody(req, res) {
  const body = bodyOf(req, res, { optional: true });
  if (!body) return null;
  const { since, until, repo, regenerate = false } = body;
  const bad = checkRepo(repo)
    || (['since', 'until'].some((k) => body[k] !== undefined && typeof body[k] !== 'string') ? '"since" and "until" must be dates like 2026-07-27' : null)
    || (typeof regenerate !== 'boolean' ? '"regenerate" must be true or false' : null);
  if (bad) { res.status(400).json({ error: bad }); return null; }
  return { since, until, repo, regenerate };
}

router.post('/summary/:login', handle(async (req, res) => {
  const range = rangeBody(req, res);
  if (!range) return;
  const out = await features.memberSummary(req.app.locals.ai, { login: req.params.login, ...range });
  res.json({ ...out, model: req.app.locals.ai.model });
}));

router.post('/explain-warning', handle(async (req, res) => {
  const range = rangeBody(req, res);
  if (!range) return;
  const out = await features.explainWarning(req.app.locals.ai, range);
  res.json({ ...out, model: req.app.locals.ai.model });
}));

module.exports = router;
