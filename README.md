# ViCollab: Contribution Scoring module

Software Engineering Lab, Assessment 8 (Team 20). This module takes a team's commits (mocked GitHub data) and works out each member's share of the work, with manual and automated tests.

## Run it

```bash
npm install
npm start            # http://localhost:3000  (home page)
                     # http://localhost:3000/app/  (the app: Connect GitHub, Dashboard, Member detail, States)
                     # http://localhost:3000/contribution-checker.html  (API testing tool)
npm test             # Jest unit + Supertest integration tests, with coverage
npm run test:postman # with the server running: runs the Postman collection through Newman
```

## API

* `POST /api/contributions/score` with a body like `{ members?, since?, until?, commits: [{ sha, author, additions, deletions, date, message }] }`
* `GET /api/health`

## Where things are

| Path | What |
|---|---|
| `src/scoring.js` | Pure scoring function |
| `src/app.js`, `src/server.js` | Express app and server start-up |
| `public/app/` | App screens: `connect.html`, `dashboard.html`, `member.html`, `states.html`, plus shared `app.js`, `app.css` and `mock-data.js` |
| `public/contribution-checker.html` | UI for manual API testing (Assessment 8) |
| `test-cases/` | Inputs for TC-01 to TC-14 (shared by the UI, Postman and Jest) |
| `tests/` | Jest + Supertest tests |
| `postman/` | Postman collection (rebuild it with `npm run postman`) |
| `docs/TEST_REPORT.md` / `.docx` | Test report (Assessment 8) |
| `docs/UI_DESIGN.md` / `.docx` | UI design write-up: purpose, requirements, screens, design principles, requirement traceability |
| `docs/ui-screens/` | Screenshots of every app screen (desktop, phone, dark mode) |
| `docs/MANUAL_TESTING.md` | Manual testing procedure with the exact inputs |
| `docs/test-output/` | Raw Jest (before and after the fixes), Newman and UI walkthrough logs |
| `docs/screenshots/` | Checker page screenshots for each test case |
