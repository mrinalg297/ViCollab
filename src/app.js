const path = require('path');
const express = require('express');
const { scoreContributions, ScoringInputError } = require('./scoring');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// the checker page can load the TC-xx inputs from here
app.use('/test-cases', express.static(path.join(__dirname, '..', 'test-cases')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'ViCollab_Home_Page.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'contribution-scoring', time: new Date().toISOString() });
});

app.post('/api/contributions/score', (req, res, next) => {
  const body = req.body;
  // req.body is undefined when nothing was sent or the Content-Type wasn't JSON (DEF-03)
  if (req.body === undefined) {
    return res.status(400).json({ error: 'No JSON body received. Send { "commits": [...] } with the header Content-Type: application/json' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Request body must be a JSON object like { "commits": [...] }' });
  }
  try {
    const { commits, members, since, until } = body;
    res.json(scoreContributions({ commits, members, since, until }));
  } catch (err) {
    if (err instanceof ScoringInputError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// unknown /api routes get JSON instead of Express's HTML page
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large (limit 1 MB)' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

module.exports = app;
