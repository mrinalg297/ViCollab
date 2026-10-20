// OLLAMA_URL / AI_MODEL from .env (built into Node 20.12+); fine if the file is missing
try { process.loadEnvFile(); } catch { /* no .env: use the defaults in src/ai.js */ }

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`ViCollab contribution scoring running at http://localhost:${PORT}`);
  console.log(`Checker page: http://localhost:${PORT}/contribution-checker.html`);
});
