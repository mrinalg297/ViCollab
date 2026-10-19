# Manual testing procedure: Contribution Scoring

This is the step-by-step procedure for running TC-01 to TC-14 by hand, first in the **checker page** (browser UI) and then in **Postman**. The exact input for each case is given in full at the end of this file. The same inputs are stored in `test-cases/`, and those files are what Jest and the Postman collection use.

## 0. Setup (once)

1. Install Node.js 18 or newer.
2. In the project folder run `npm install`.
3. Run `npm start`. The terminal should print `ViCollab contribution scoring running at http://localhost:3000`.
4. Keep that terminal open for the rest of the testing.

## A. Manual testing through the UI (contribution-checker.html)

1. Open `http://localhost:3000/` in Chrome or Firefox. This is the ViCollab home page.
2. Click **Contribution checker** in the top nav. (The nav is hidden below 700 px width, so widen the window if you can't see it.) You land on `http://localhost:3000/contribution-checker.html`.
3. **Smoke test:** click **Load sample data**, then **Score contributions**. The status pill should turn green (HTTP 200) and the table should show 4 members (Meera 33.7, Aarav 29.6, Isha 23.8, Kabir 12.9), with 2 skipped (1 duplicate, 1 merge).
4. For each test case TC-01 to TC-13:
   1. Click **Clear**.
   2. Paste that case's input (from the section **Exact inputs** below) into the **Request body (JSON)** box. The **Load a test case** dropdown does the same thing in one click: it fills the box and shows the *Expected result* panel.
   3. Click **Score contributions**.
   4. Read the result:
      * **Status pill** (top right of Results): HTTP code. Green means 2xx, red means 4xx/5xx.
      * **Stat tiles**: members, valid commits, lines changed, skipped (broken down by duplicates, merges and date).
      * **Results table**: commits, lines changed, commit share, lines share and score for each member.
      * **Warnings** (yellow) and **Errors** (red) lists.
      * **Raw response**: expand it to see the exact JSON the API returned.
   5. Compare with the *Expected* column in the test report and write down Pass or Fail.
5. **TC-14 (health check):** click **GET /api/health**, or the **API health** button in the nav, which opens the raw JSON in a new tab.

> TC-11 sends broken JSON on purpose. The page sends the box exactly as typed and never parses it first, so the server's own error handling is what gets tested. **Format JSON** shows an error for this case, which is expected.

## B. Manual testing through Postman

1. Open Postman and choose **Import → File → `postman/ViCollab_Contribution_Scoring.postman_collection.json`**.
2. The collection has a variable `baseUrl = http://localhost:3000`. Check it under **Collection → Variables** if the server runs on another port.
3. For each request `TC-01 …` to `TC-14 …`:
   1. Open the request. The method, URL, `Content-Type: application/json` header and **Body → raw** are already filled in with the exact input from this file.
   2. Click **Send**.
   3. Look at the **status code** (top right of the response panel, e.g. `200 OK` or `400 Bad Request`) and the response **Body** (Pretty view).
   4. Open the **Test Results** tab. Each request has 2 to 5 `pm.test` checks that compare against the expected values, and each check shows PASS or FAIL.
4. To make a request yourself instead: **New → HTTP**, method **POST**, URL `http://localhost:3000/api/contributions/score`, **Headers** `Content-Type: application/json`, **Body → raw → JSON**, then paste the input from below.
5. To run everything at once: **Collection → Run → Run ViCollab Contribution Scoring**. From the command line, `npm run test:postman` does the same with Newman while the server is running.

### Postman-only extra checks
* Change the TC-01 header to `Content-Type: text/plain` and send it. Expect 400 with *"No JSON body received. Send { "commits": [...] } with the header Content-Type: application/json"* (this was DEF-03).
* Send TC-01 to `GET /api/contributions/score`, which is the wrong method. Expect a JSON 404: *"No route for GET /api/contributions/score"*.

## Exact inputs

### TC-01: Balanced team: 3 members, 2 commits and 100 lines each

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-01.json`
* **Expected:** 200. Aarav, Meera, Kabir each: commits 2, linesChanged 100, commitShare 33.3, linesShare 33.3, score 33.3. warnings [], errors []
* **Where to look (UI):** Results table: 3 rows, every Score is 33.3. Warnings (0), Errors (0).

```json
{
  "members": ["Aarav", "Meera", "Kabir"],
  "commits": [
    { "sha": "a1f001", "author": "Aarav", "additions": 40, "deletions": 10, "date": "2026-03-02T10:00:00Z", "message": "feat: github oauth callback" },
    { "sha": "a1f002", "author": "Aarav", "additions": 30, "deletions": 20, "date": "2026-03-04T11:00:00Z", "message": "fix: token refresh" },
    { "sha": "b2e001", "author": "Meera", "additions": 45, "deletions": 5, "date": "2026-03-02T12:00:00Z", "message": "feat: dashboard layout" },
    { "sha": "b2e002", "author": "Meera", "additions": 35, "deletions": 15, "date": "2026-03-05T09:30:00Z", "message": "style: dashboard cards" },
    { "sha": "c3d001", "author": "Kabir", "additions": 25, "deletions": 25, "date": "2026-03-03T14:00:00Z", "message": "feat: socket.io chat room" },
    { "sha": "c3d002", "author": "Kabir", "additions": 50, "deletions": 0, "date": "2026-03-06T16:00:00Z", "message": "feat: typing indicator" }
  ]
}
```

### TC-02: One dominant member (Aarav 6 of 10 commits, 700 of 1000 lines)

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-02.json`
* **Expected:** 200. Aarav 60 / 70 / score 64.0; Meera 20 / 20 / 20.0; Kabir 20 / 10 / 16.0. One warning that Aarav is above 60%
* **Where to look (UI):** Results table: Aarav 64.0 (yellow bar), Meera 20.0, Kabir 16.0. Warnings (1): "Aarav has 64% of the score (above 60%)...".

```json
{
  "members": ["Aarav", "Meera", "Kabir"],
  "commits": [
    { "sha": "d001", "author": "Aarav", "additions": 100, "deletions": 20, "date": "2026-03-01T10:00:00Z", "message": "feat: auth service" },
    { "sha": "d002", "author": "Aarav", "additions": 90, "deletions": 30, "date": "2026-03-02T10:00:00Z", "message": "feat: team api" },
    { "sha": "d003", "author": "Aarav", "additions": 100, "deletions": 20, "date": "2026-03-03T10:00:00Z", "message": "feat: task api" },
    { "sha": "d004", "author": "Aarav", "additions": 80, "deletions": 30, "date": "2026-03-04T10:00:00Z", "message": "feat: notifications" },
    { "sha": "d005", "author": "Aarav", "additions": 90, "deletions": 20, "date": "2026-03-05T10:00:00Z", "message": "feat: github sync job" },
    { "sha": "d006", "author": "Aarav", "additions": 100, "deletions": 20, "date": "2026-03-06T10:00:00Z", "message": "refactor: services folder" },
    { "sha": "d007", "author": "Meera", "additions": 80, "deletions": 20, "date": "2026-03-03T12:00:00Z", "message": "feat: login page" },
    { "sha": "d008", "author": "Meera", "additions": 70, "deletions": 30, "date": "2026-03-05T12:00:00Z", "message": "feat: team page" },
    { "sha": "d009", "author": "Kabir", "additions": 40, "deletions": 10, "date": "2026-03-04T15:00:00Z", "message": "chore: eslint config" },
    { "sha": "d010", "author": "Kabir", "additions": 30, "deletions": 20, "date": "2026-03-06T15:00:00Z", "message": "docs: readme setup" }
  ]
}
```

### TC-03: Single-member team (Isha only)

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-03.json`
* **Expected:** 200. Isha: commits 3, linesChanged 100, 100 / 100 / score 100. No dominance warning because the team has 1 member
* **Where to look (UI):** Results table: one row, Isha 100.0. Warnings (0).

```json
{
  "members": ["Isha"],
  "commits": [
    { "sha": "e001", "author": "Isha", "additions": 40, "deletions": 10, "date": "2026-03-02T10:00:00Z", "message": "test: scoring unit tests" },
    { "sha": "e002", "author": "Isha", "additions": 25, "deletions": 5, "date": "2026-03-03T10:00:00Z", "message": "test: api tests" },
    { "sha": "e003", "author": "Isha", "additions": 15, "deletions": 5, "date": "2026-03-04T10:00:00Z", "message": "docs: test report" }
  ]
}
```

### TC-04: Listed member with zero commits (Isha)

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-04.json`
* **Expected:** 200. Aarav 50 / 60 / 54.0; Meera 25 / 20 / 23.0; Kabir 25 / 20 / 23.0; Isha 0 / 0 / 0. Warning "Isha has 0 valid commits"
* **Where to look (UI):** Results table: Isha row is greyed out with 0 / 0 / 0.0 and a red bar. Warnings (1): "Isha has 0 valid commits".

```json
{
  "members": ["Aarav", "Meera", "Kabir", "Isha"],
  "commits": [
    { "sha": "f001", "author": "Aarav", "additions": 30, "deletions": 10, "date": "2026-03-02T10:00:00Z", "message": "feat: profile api" },
    { "sha": "f002", "author": "Aarav", "additions": 15, "deletions": 5, "date": "2026-03-03T10:00:00Z", "message": "fix: profile validation" },
    { "sha": "f003", "author": "Meera", "additions": 15, "deletions": 5, "date": "2026-03-03T12:00:00Z", "message": "feat: profile page" },
    { "sha": "f004", "author": "Kabir", "additions": 10, "deletions": 10, "date": "2026-03-04T12:00:00Z", "message": "feat: chat notifications" }
  ]
}
```

### TC-05: Duplicate sha (g001 sent 3 times)

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-05.json`
* **Expected:** 200. g001 counted once: Aarav 1 commit / 50 lines, Meera 1 / 50, both 50 / 50 / 50.0. skipped.duplicates = 2
* **Where to look (UI):** Stat tile "skipped" shows 2 (2 dup). Table: Aarav 1 commit, Meera 1 commit, both 50.0.

```json
{
  "members": ["Aarav", "Meera"],
  "commits": [
    { "sha": "g001", "author": "Aarav", "additions": 40, "deletions": 10, "date": "2026-03-02T10:00:00Z", "message": "feat: skill tags" },
    { "sha": "g001", "author": "Aarav", "additions": 40, "deletions": 10, "date": "2026-03-02T10:00:00Z", "message": "feat: skill tags" },
    { "sha": "g001", "author": "Aarav", "additions": 40, "deletions": 10, "date": "2026-03-02T10:00:00Z", "message": "feat: skill tags" },
    { "sha": "g002", "author": "Meera", "additions": 30, "deletions": 20, "date": "2026-03-03T10:00:00Z", "message": "feat: skill tag picker" }
  ]
}
```

### TC-06: Merge commits ignored ("Mergesort ..." is a normal commit)

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-06.json`
* **Expected:** 200. skipped.merges = 2. Aarav 1 / 30 lines / 32.0; Meera 1 / 30 / 32.0; Kabir 1 / 40 / 36.0 (commitShare 33.3 each)
* **Where to look (UI):** Stat tile "skipped" shows 2 (2 merge). Table: Kabir 36.0, Aarav 32.0, Meera 32.0.

```json
{
  "members": ["Aarav", "Meera", "Kabir"],
  "commits": [
    { "sha": "h001", "author": "Aarav", "additions": 20, "deletions": 10, "date": "2026-03-02T10:00:00Z", "message": "feat: oauth scopes" },
    { "sha": "h002", "author": "Meera", "additions": 25, "deletions": 5, "date": "2026-03-02T12:00:00Z", "message": "feat: settings page" },
    { "sha": "h003", "author": "Meera", "additions": 450, "deletions": 50, "date": "2026-03-03T09:00:00Z", "message": "Merge pull request #7 from team20/oauth" },
    { "sha": "h004", "author": "Kabir", "additions": 180, "deletions": 20, "date": "2026-03-03T11:00:00Z", "message": "Merge branch 'main' into chat" },
    { "sha": "h005", "author": "Kabir", "additions": 30, "deletions": 10, "date": "2026-03-04T15:00:00Z", "message": "Mergesort for the task list" }
  ]
}
```

### TC-07: Invalid commits mixed with valid ones (missing author, negative additions, bad date, additions as text)

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-07.json`
* **Expected:** 200, no crash. errors has 4 entries (index 2 missing author, 3 additions, 4 invalid date, 5 additions). Aarav 50 / 40 / 46.0; Meera 50 / 60 / 54.0
* **Where to look (UI):** Status pill is HTTP 200 (green). Errors (4) lists #2 missing author, #3 additions, #4 invalid date, #5 additions. Table: Meera 54.0, Aarav 46.0.

```json
{
  "members": ["Aarav", "Meera"],
  "commits": [
    { "sha": "i001", "author": "Aarav", "additions": 30, "deletions": 10, "date": "2026-03-02T10:00:00Z", "message": "feat: invite links" },
    { "sha": "i002", "author": "Meera", "additions": 40, "deletions": 20, "date": "2026-03-02T12:00:00Z", "message": "feat: invite page" },
    { "sha": "i003", "additions": 10, "deletions": 0, "date": "2026-03-03T10:00:00Z", "message": "no author on this one" },
    { "sha": "i004", "author": "Aarav", "additions": -5, "deletions": 3, "date": "2026-03-03T11:00:00Z", "message": "negative additions" },
    { "sha": "i005", "author": "Meera", "additions": 5, "deletions": 5, "date": "next tuesday", "message": "bad date" },
    { "sha": "i006", "author": "Meera", "additions": "12", "deletions": 0, "date": "2026-03-04T11:00:00Z", "message": "additions sent as text" }
  ]
}
```

### TC-08: Date filter since 2026-03-01, until 2026-03-15 (until day is inclusive)

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-08.json`
* **Expected:** 200. skipped.outsideDateRange = 2. Aarav 1 / 50 / 50.0; Meera 1 / 50 / 50.0 (commit at 18:30 on the 15th is kept); Kabir 0 with a 0-commits warning
* **Where to look (UI):** Stat tile "skipped" shows 2 (2 date). Table: Aarav 50.0, Meera 50.0, Kabir 0.0. Warnings (1): "Kabir has 0 valid commits".

```json
{
  "members": ["Aarav", "Meera", "Kabir"],
  "since": "2026-03-01",
  "until": "2026-03-15",
  "commits": [
    { "sha": "j001", "author": "Aarav", "additions": 200, "deletions": 0, "date": "2026-02-25T10:00:00Z", "message": "chore: project skeleton (before since)" },
    { "sha": "j002", "author": "Aarav", "additions": 40, "deletions": 10, "date": "2026-03-02T10:00:00Z", "message": "feat: sprint 2 api" },
    { "sha": "j003", "author": "Meera", "additions": 30, "deletions": 20, "date": "2026-03-15T18:30:00Z", "message": "feat: sprint 2 ui (evening of the until day)" },
    { "sha": "j004", "author": "Kabir", "additions": 60, "deletions": 0, "date": "2026-03-20T10:00:00Z", "message": "feat: sprint 3 chat (after until)" }
  ]
}
```

### TC-09: Empty commit list

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-09.json`
* **Expected:** 400 { error: "\"commits\" must be a non-empty array of commit objects" }
* **Where to look (UI):** Status pill HTTP 400 (red). Red box: "commits" must be a non-empty array of commit objects.

```json
{
  "members": ["Aarav", "Meera"],
  "commits": []
}
```

### TC-10: commits field missing from the body

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-10.json`
* **Expected:** 400 { error: "\"commits\" must be a non-empty array of commit objects" }
* **Where to look (UI):** Status pill HTTP 400 (red). Red box: same message as TC-09.

```json
{
  "members": ["Aarav", "Meera"]
}
```

### TC-11: Malformed request body (truncated JSON)

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-11.txt`
* **Expected:** 400 { error: "Request body is not valid JSON" } returned as JSON, server keeps running
* **Where to look (UI):** Status pill HTTP 400 (red). Red box: "Request body is not valid JSON". Then press GET /api/health to confirm the server is still up.

```text
{ "members": ["Aarav"], "commits": [ { "sha": "k001", "author": "Aarav", "additions": 10, 
```

### TC-12: Score exactly 60% (limit is "above 60")

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-12.json`
* **Expected:** 200. Aarav 60 / 60 / score 60.0; Meera 40 / 40 / 40.0. No dominance warning (60.0 is not above 60)
* **Where to look (UI):** Table: Aarav 60.0, Meera 40.0. Warnings (0): 60.0 is not above 60.

```json
{
  "members": ["Aarav", "Meera"],
  "commits": [
    { "sha": "l001", "author": "Aarav", "additions": 15, "deletions": 5, "date": "2026-03-02T10:00:00Z", "message": "feat: task board" },
    { "sha": "l002", "author": "Aarav", "additions": 15, "deletions": 5, "date": "2026-03-03T10:00:00Z", "message": "feat: task filters" },
    { "sha": "l003", "author": "Aarav", "additions": 10, "deletions": 10, "date": "2026-03-04T10:00:00Z", "message": "fix: task sort" },
    { "sha": "l004", "author": "Meera", "additions": 15, "deletions": 5, "date": "2026-03-03T12:00:00Z", "message": "feat: task card" },
    { "sha": "l005", "author": "Meera", "additions": 10, "deletions": 10, "date": "2026-03-04T12:00:00Z", "message": "style: task card" }
  ]
}
```

### TC-13: Only empty commits (0 lines changed in total)

* **Request:** `POST /api/contributions/score`
* **File:** `test-cases/TC-13.json`
* **Expected:** 200, no NaN. Aarav and Meera: commits 2, linesChanged 0, commitShare 50, linesShare 0, score 30.0
* **Where to look (UI):** Table: Aarav and Meera both show Lines share 0.0% and Score 30.0. No "NaN" anywhere.

```json
{
  "members": ["Aarav", "Meera"],
  "commits": [
    { "sha": "m001", "author": "Aarav", "additions": 0, "deletions": 0, "date": "2026-03-02T10:00:00Z", "message": "chore: empty commit to trigger CI" },
    { "sha": "m002", "author": "Aarav", "additions": 0, "deletions": 0, "date": "2026-03-03T10:00:00Z", "message": "chore: re-run CI" },
    { "sha": "m003", "author": "Meera", "additions": 0, "deletions": 0, "date": "2026-03-03T12:00:00Z", "message": "chore: empty commit" },
    { "sha": "m004", "author": "Meera", "additions": 0, "deletions": 0, "date": "2026-03-04T12:00:00Z", "message": "chore: empty commit" }
  ]
}
```

### TC-14: Health check

* **Request:** `GET /api/health`
* **Expected:** 200 { status: "ok", service: "contribution-scoring", time: <ISO date> }
* **Where to look (UI):** Results card shows "Health: ok · contribution-scoring · <time>" and pill HTTP 200.

No body. In the UI click **GET /api/health**; in Postman send the `TC-14 Health check` request.
