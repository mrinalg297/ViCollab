const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`ViCollab contribution scoring running at http://localhost:${PORT}`);
  console.log(`Checker page: http://localhost:${PORT}/contribution-checker.html`);
});
