# Hiring Intelligence

A mentor-led hiring platform: candidates are assessed by real mentors on versioned
question banks, automation only does the boring parts, and companies search
anonymised candidates until a candidate consents to an introduction.

Five roles ship in one product: **super admin**, **admin**, **mentor**,
**candidate** and **company**.

## Stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| API | Fastify modular monolith, REST under `/v1`, Zod request validation |
| DB | PostgreSQL, raw SQL migrations (no ORM) |
| Web | React 19 + Vite |
| Auth | JWT, scrypt password hashing from the Node standard library |
| Monorepo | npm workspaces |

```
backend/api       Fastify API + in-process re-assessment/staleness worker
backend/db        migrations, pool, seed, snapshot cloning
backend/shared    constants, Zod schemas, diff + scoring helpers
frontend          React single-page app (standalone workspace)
scripts/smoke.ts  end-to-end living spec for every role
```

Backend and frontend are separate workspaces with no source-level dependency:
`frontend` talks to the API only over `/v1`, so backend and frontend engineers can
work, test and deploy independently.

## Quick start

Requirements: Node 20+, npm, PostgreSQL 14+.

```bash
# 1. Create the database (any local Postgres works)
createdb hiring_intelligence

# 2. Configure
cp .env.example .env          # edit DATABASE_URL / JWT_SECRET if needed

# 3. Install and prepare
npm install
npm run db:migrate
npm run db:seed

# 4. Run the API (also starts the re-assessment worker)
npm run dev:api               # http://localhost:4000

# 5. In another terminal, run the web app
npm run dev:web               # http://localhost:5173
```

The Vite dev server proxies `/v1` to `http://localhost:4000`, so the browser only
talks to `:5173`.

For the demo and Lighthouse, serve the production build instead of the dev
server:

```bash
npm run demo                  # build + preview on http://localhost:4173
```

### Seed accounts

All seeded accounts use the password **`Password123!`**.

| Email | Role | Notes |
| --- | --- | --- |
| `super@hi.test` | super admin | users, policies, audit log |
| `admin@hi.test` | admin | applications, users, policies, audit |
| `mentor@hi.test` | mentor | 12 years experience, verified |
| `mentor2@hi.test` | mentor | 11 years experience, verified |
| `candidate@hi.test` | candidate | 4 years, discoverable, v1 round evaluated at 45/50 |
| `candidate2@hi.test` | candidate | 6 years, discoverable |
| `company@hi.test` | company | member of Acme Technologies |

### Useful commands

```bash
npm run dev:api      # API + worker
npm run dev:web      # Vite dev server
npm run typecheck    # all workspaces
npm run build        # typecheck + production web build
npm run preview:web  # serve the built app on :4173
npm run demo         # build + serve the built app on :4173
npm run db:migrate   # apply pending SQL migrations
npm run db:seed      # idempotent seed
npm run db:reset     # drop schema, remigrate, reseed (destructive)
npm run smoke        # end-to-end check; API must already be running
```

## What each role can do

**Candidate** — maintain profile, skills and resumes; complete sandbox eKYC;
apply for a specific job role; start, resume and submit assessment rounds; see
auto scores, carried-forward scores and mentor feedback; accept or reject company
introductions. Timed attempts show a countdown and auto-submit at zero; the
server also marks overdue submissions `expired`. Tab switches, window blur,
fullscreen changes and time expiry during an attempt are recorded as assessment
events.

**Mentor** — see assigned candidates, create assessment rounds from a template,
watch attempt events, score answers question-by-question, record a decision
(`proceed`, `hold`, `reject`, …) and schedule a re-assessment. Publishing a new
template version queues a **delta-only** re-assessment round for candidates who
attempted an older version: unchanged question keys reuse their stored scores,
only changed/new questions are asked, and the total is updated and notified.

**Admin** — review applications, route an application to candidate or mentor by
experience, assign mentors, manage users and policies, read the audit log.

**Super admin** — create admins, grant/deny fine-grained permissions, manage
platform settings and inspect the audit trail.

**Company** — sign up with a business email domain (free mailbox domains are
blocked); search only discoverable, assessed candidates through an anonymised
role-aware view; request an introduction with a message; see name, email and
phone only after the candidate accepts; withdraw pending requests.

## API surface (`/v1`)

All routes except `POST /auth/register` and `POST /auth/login` require
`Authorization: Bearer <jwt>`. Responses are JSON; errors are
`{ error, issues? }`.

### Auth and profile

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/register` | candidate / mentor / company sign-up |
| POST | `/auth/login` | returns `{ token, user }` |
| GET | `/auth/me` | current actor, roles and effective permissions |
| POST | `/auth/kyc` | sandbox identity verification (consent required) |
| GET | `/candidate/profile` | profile, skills, resumes, applications |
| PUT | `/candidate/profile` | update profile, skills and discoverability |
| GET | `/candidate/resumes` | list resumes |
| POST | `/candidate/resumes` | multipart upload (PDF/DOC/DOCX/TXT) |
| GET | `/candidate/resumes/:id/file` | download, permission-checked |

### Applications

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/applications/mine` | own applications |
| POST | `/applications` | apply as candidate or mentor for a job role (KYC required) |
| GET | `/applications` | admin review queue |
| POST | `/applications/:id/review` | approve/reject, set experience, optionally `routeTo` candidate or mentor |
| POST | `/applications/:id/assign-mentor` | route to a mentor |

### Mentoring and assessments

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/mentor/candidates` | assigned candidates with best score |
| GET | `/mentor/assignments/:id` | assignment detail and round history |
| GET | `/mentor/templates` | templates and latest version |
| GET | `/mentor/templates/:id` | one template with versions |
| POST | `/mentor/templates` | create a template (snapshot) |
| POST | `/mentor/templates/:id/versions` | publish an immutable new version |
| POST | `/mentor/templates/:id/impact` | diff a snapshot against the latest version |
| POST | `/mentor/rounds` | create a round from a template version |
| GET | `/mentor/rounds/:id` | questions, answer keys, attempts, events |
| POST | `/mentor/attempts/:id/evaluate` | per-question mentor scores and feedback |
| POST | `/mentor/rounds/:id/decision` | final mentor decision |
| GET | `/mentor/rankings` | mentor leaderboard |

### Candidate assessments

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/candidate/rounds` | own rounds with latest attempt and carried score |
| GET | `/candidate/rounds/:id` | round questions (never answer keys) |
| POST | `/candidate/rounds/:id/start` | start or resume an attempt; returns timer and carried score |
| POST | `/candidate/attempts/:id/events` | tab/blur/fullscreen events |
| POST | `/candidate/attempts/:id/submit` | auto-score objective answers; server marks expired attempts |
| GET | `/candidate/attempts/:id/result` | own result, carried score and feedback |
| GET | `/candidate/introductions` | company requests |
| POST | `/candidate/introductions/:id/respond` | accept or reject |

### Company

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/company/me` | company profile and member count |
| GET | `/company/search` | anonymised search (`q`, `role`, `skill`, `minExperience`, `minScore`, `limit`, `offset`) |
| GET | `/company/search/:ref` | one anonymised candidate |
| POST | `/company/introductions` | request an introduction |
| GET | `/company/introductions` | own requests; contact gated on `accepted` |
| POST | `/company/introductions/:id/withdraw` | withdraw a pending request |

### Admin, settings and notifications

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/admin/users` | create an admin with explicit permissions |
| GET | `/admin/users` | list users, roles, KYC state |
| PATCH | `/admin/users/:id/permissions` | allow/deny grants |
| GET | `/admin/audit` | audit log |
| GET | `/settings` | platform settings |
| PUT | `/settings/:key` | update a setting |
| GET | `/meta` | constants (roles, permissions, question types) |
| GET | `/notifications` | own notifications |
| POST | `/notifications/:id/read` | mark one read |
| POST | `/notifications/read-all` | mark all read |

## Data model and versioning

The deck specified 24 tables. This build has **29 application tables** (+ the
`_migrations` bookkeeping table). The extra five:

| Table | Why |
| --- | --- |
| `assessment_templates` | stable identity for a question bank |
| `template_versions` | immutable JSONB snapshots with `version_number` |
| `identity_verifications` | consent-only KYC record (provider ref, never an Aadhaar number) |
| `platform_settings` | editable policies such as the mentor experience threshold |
| `jobs` | transactional outbox for re-assessment work |

### Template → version → round

1. A mentor creates an **assessment template** with a versioned snapshot of levels
   and questions. Questions carry a stable `question_key`.
2. Publishing a version makes a new **immutable** `template_versions` row.
3. A **round** references the template version and stores `version_number`.
4. When a round is created, questions are **cloned into the round**, so later
   template edits never mutate an attempt that already happened.
5. Publishing a new version queues a `reassess` job for every assignment that
   actually attempted an older version. The worker diffs against the version the
   candidate sat using stable `question_key` values, creates a new round titled
   `"<title> (re-assessment vN)"`, copies only changed/new questions, stores the
   carried-forward score (and its per-question breakdown), updates the total and
   notifies the candidate. If nothing material changed, no round is created.
   A daily sweep flags stale evaluated assessments older than 365 days and
   notifies the candidate and mentor.

This gives version comparison (`POST /mentor/templates/:id/impact`), delta
re-assessment and a permanent audit trail without freezing editing for mentors.

### Invariants enforced in the database and code

- `final_score = COALESCE(mentor_score, ai_score, auto_score)` — the mentor
  decision always wins. `candidate_answers.final_score` is a generated column;
  evaluators never clobber a human score with automation.
- Objective types (`mcq`, `multiple_select`, `true_false`, `short_answer`) are
  auto-scored on submit. Descriptive, coding and practical answers stay `NULL`
  until a mentor scores them.
- Answer keys are never returned by candidate endpoints.
- Company search reads the `company_candidate_search` view: no names, emails,
  phones, resumes or answers. Contact fields appear in introductions only when
  the status is `accepted`.
- `profiles.public_ref` is a random UUID, not a sequential ID, so candidate
  references cannot be enumerated.
- Role permissions are checked twice: role (`requireRole`) and effective
  permission (`requirePermission`). Deny grants override defaults.
- Every sensitive mutation writes an `audit_logs` row and notifications are
  written transactionally.

### Schema notes

- Money/score columns are `NUMERIC`; `bigint` and `numeric` values are parsed to
  JS numbers in `backend/db/src/pool.ts`.
- Migrations are checksum-enforced. Never edit an applied migration — add a new
  numbered file such as `0004_*.sql`.
- `npm run db:reset` drops the public schema, remigrates and reseeds; it is the
  fastest way to get back to a known state before running the smoke test.
- A re-assessment round is still linked to its source version, keeps
  `reassessment_of_round_id`, `carried_score` and a JSONB `carried_scores` map so
  later versions can carry the right per-question scores forward.

## Performance / Lighthouse

Lighthouse was run against the **production build**, not the dev server. Both the
preview build and the warmed Vite dev server score 100 in every category:

| URL | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| `http://localhost:4173/` (production preview) | 100 | 100 | 100 | 100 |
| `http://localhost:5173/` (Vite dev) | 100 | 100 | 100 | 100 |

Production metrics: FCP 0.8 s, LCP 0.8 s, TBT 0 ms, CLS 0, Speed Index 0.8 s.

```bash
npm run demo        # build + serve on :4173
npx lighthouse http://localhost:4173/ \
  --only-categories=performance,accessibility,best-practices,seo \
  --chrome-flags="--headless=new" --view
```

The fixes that got it there: production asset serving, route-level code splitting,
a real `<main>` landmark on auth screens, WCAG-AA muted text, meta description,
valid `robots.txt`, an SVG favicon, and no console errors.

## Smoke test

`scripts/smoke.ts` is the living specification for the whole product. With the
API running and a freshly seeded database, it logs in as all five roles and walks
through profile creation, round creation, auto-scoring, mentor override,
template v2 publication, the re-assessment worker, anonymised company search,
consent-gated contact details, admin creation, policy updates, notifications and
role guards.

```bash
npm run db:reset
npm run dev:api     # terminal 1
npm run smoke       # terminal 2
```

Expected tail:

```
All smoke checks passed
```
