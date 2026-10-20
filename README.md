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
                     # (AI-01 to AI-11 pass with 200, or with 503 when Ollama is off)
```

## AI features (optional, local)

The AI features run on a local model through [Ollama](https://ollama.com) (OpenAI-compatible API). They never change a score: every number comes from `scoreContributions`, and the model only words it. Without Ollama the app works as before and the AI spots show **"AI unavailable"**.

```bash
# 1. install Ollama, then:
ollama pull qwen3:8b
ollama serve                 # skip if the Ollama app is already running (it listens on :11434)

# 2. configure (optional, these are the defaults)
cp .env.example .env         # OLLAMA_URL=http://localhost:11434, AI_MODEL=qwen3:8b

npm start
```

`.env` is read by `src/server.js` with Node's built-in `process.loadEnvFile()` (Node 20.12+), so there is no extra dependency. `.env` is git-ignored.

Speed settings (all in `src/ai.js` / `src/ai-features.js`):

* **Thinking off everywhere**, chat included. Ollama's `/v1` endpoint ignores the native `think: false` field, so `src/ai.js` also sends `reasoning_effort: "none"`, which is what actually turns Qwen3's thinking off there (checked on Ollama 0.40.4).
* **`keep_alive`** is sent with every request (default `30m`, `AI_KEEP_ALIVE` in `.env`), so the model stays loaded between questions instead of reloading after Ollama's 5-minute default.
* **Chat replies are capped** at 300 tokens. The chat tool returns only what an answer needs, never commits: the period, team totals, and per member commits, lines, shares, score, **rank**, **aboveLimit**, **difference from an equal share** (100 / team size) and **inactive weeks** (weeks in the period with 0 commits).
* **The server does every comparison, the model only repeats it.** The tool result has team-level `top`, `bottom` and `balanced`, plus one plain sentence per fact (`facts.limit`, `ranking`, `topBottom`, `equalShare`, `inactive`, `balance`). The system prompt tells the model to repeat these for any comparison or ranking, never to compare numbers itself, and to say it can't answer precisely when a comparison isn't covered. **"Balanced"** means nobody above the 60% limit, everyone made commits, and every score within half an equal share of it (12.5–37.5 points for 4 people). It's set by `BALANCE_BAND` in `src/ai-features.js`.
* **One tool call per simple question:** the model passes a `period` such as "Sprint 1", "last 4 weeks", "week 5" or "weeks 3-5", and the server turns it into dates. Once a tool call has worked, the next request offers no tools, so the model has to answer.
* **Streaming:** the dashboard chat shows the reply word by word (see `stream` below).

Measured on the test machine with `qwen3:8b` (warm): chat answers start after about **0.7–0.9 s** and finish in **1.1–2.7 s** (first question after Ollama starts: 4.7 s, while the model loads). Before these changes chat took 30–50 s. Summaries and explanations take 2–4 s, classifying 28 commits about 24 s.

**Accuracy with thinking off:** before the precomputed facts, the model sometimes got a comparison wrong while quoting real numbers ("Aarav has 48.6, which is above the 60% limit": 2 of 8 runs). With the facts, a live re-run of 12 questions was right in 40 of 40 runs, including 8 of 8 on that question and 3 of 3 each for "anyone above 60%?", "who contributed least?", "who went inactive?" and "is the work balanced?". Times were 1.1–2.7 s per answer. Remaining limit: the number check can't judge wording, e.g. one answer called 62.2 "significantly above" 60.

## API

* `POST /api/contributions/score` with a body like `{ members?, since?, until?, commits: [{ sha, author, additions, deletions, date, message }] }`
* `GET /api/health`

AI endpoints (all `POST`, JSON in and out). Input is checked before the model is called, so bad input is a 400 even with Ollama off. Errors: **503** `{ "error": "AI unavailable" }` when Ollama can't be reached, the model isn't pulled or the call timed out; **502** when the model's answer still fails validation after one retry.

| Endpoint | Body | Returns |
|---|---|---|
| `/api/ai/chat` | `{ message, history?: [{ role: "user"\|"assistant", content }], context?: { since, until }, repo?, stream?: boolean }` | `{ reply, sources: [{ tool, args, ok }], grounded, model }`. The model has two tools, `score_contributions(period \| since/until, members)` and `get_project_info`, run on the mock data. Every number in `reply` is checked against the tool results (and the question); an answer with any other number is sent back once and then rejected (502). With `"stream": true` the response is `application/x-ndjson`, one JSON event per line: `tool`, `delta` (reply text as it is generated), `reset` (discard the text so far, e.g. the number check failed and the model is asked again), then `done` (same fields as above; if the retry still has unchecked numbers, `grounded: false` and `ungrounded: [...]` instead of a 502) or `error` (`{ status, error }`). Errors before the first event are normal JSON responses (400, 503). |
| `/api/ai/classify` | `{ commits: [{ sha, message }] }` (1–300) | `{ results: [{ sha, type, trivial }], cached, classified, model }`. `type` is one of feat, fix, test, docs, chore, refactor. Sent in even batches of 20–30, validated, retried once, cached by sha. Not used by the score. |
| `/api/ai/summary/:login` | `{ since?, until?, repo?, regenerate?: boolean }` | `{ login, range, summary, roleMismatch, stats, cached, generatedAt, model }`. A 2–3 sentence summary from the member's computed stats, weekly commits, role, skills and commit messages. Saved per member, repo and date range, so a repeat is instant (`cached: true`) with the same wording. `regenerate: true` writes a new one (at temperature 0.7, so the wording changes) and saves it. Failures are never saved. 404 for an unknown login. |
| `/api/ai/explain-warning` | `{ since?, until?, repo?, regenerate?: boolean }` | `{ member, range, warning, explanation, caveats, cached, generatedAt, model }`. Why the member is above 60%, and where the score may mislead. Saved per repo and date range, and regenerated the same way as summaries. 400 if there is no dominance warning in the range. |

`repo` defaults to `mrinalg297/vicollab`; the others in `public/app/mock-data.js` can be used too.

## Where things are

| Path | What |
|---|---|
| `src/scoring.js` | Pure scoring function |
| `src/app.js`, `src/server.js` | Express app and server start-up |
| `src/ai.js` | The LLM client (`chat`, `completeJSON`); every model call goes through it |
| `src/ai-features.js`, `src/ai-routes.js` | AI features (tools, grounding check, validation and retry, cache) and the `/api/ai/*` routes |
| `.env.example` | `OLLAMA_URL`, `AI_MODEL` (copy to `.env`) |
| `public/app/` | App screens: `connect.html`, `dashboard.html`, `member.html`, `states.html`, plus shared `app.js`, `app.css` and `mock-data.js` |
| `public/contribution-checker.html` | UI for manual API testing (Assessment 8) |
| `test-cases/` | Inputs for TC-01 to TC-14 (shared by the UI, Postman and Jest) |
| `tests/` | Jest + Supertest tests. The AI tests use a fake client (`tests/helpers/fake-ai.js`), so none needs a running model. |
| `postman/` | Postman collection (rebuild it with `npm run postman`) |
| `docs/TEST_REPORT.md` / `.docx` | Test report (Assessment 8) |
| `docs/UI_DESIGN.md` / `.docx` | UI design write-up: purpose, requirements, screens, design principles, requirement traceability |
| `docs/ui-screens/` | Screenshots of every app screen (desktop, phone, dark mode) |
| `docs/MANUAL_TESTING.md` | Manual testing procedure with the exact inputs |
| `docs/test-output/` | Raw Jest (before and after the fixes), Newman and UI walkthrough logs |
| `docs/screenshots/` | Checker page screenshots for each test case |
