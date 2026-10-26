# AICTE Demo Website / एआईसीटीई डेमो वेबसाइट: approval workflow and compliance monitoring (SIH 2026 prototype)

Working prototype for the Smart India Hackathon 2026 AICTE problem statement *Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System*. This build covers phases 0 to 4 of the final architecture (v3).

The system routes, assigns, reminds, explains and records. It never decides: the only approve or reject is the competent authority's **Decide** action, which always needs a human click and a reason.

> **What is placeholder.** All timelines, routes, application types, document lists, assignment weights, capacities and thresholds are pending verification against the APH and with AICTE officers. Holidays are placeholder dates. Form check results (including `formcheck/EVALUATION.md`) are measured on synthetic data. All people and institutions are fictional.

> **Placeholders.** All timelines, routes, application types, document lists, weights and thresholds are placeholders pending verification against the AICTE Approval Process Handbook (APH) and with AICTE officers. Form check results are measured on synthetic data.

## Quick start (about 10 minutes, most of it the first image build)

You need three things on the machine:

| Tool | Version | Check with |
|---|---|---|
| Docker Desktop (or Docker Engine with the Compose plugin) | any recent | `docker compose version` |
| Node.js | 20 or newer | `node -v` |
| Git | any | `git --version` |

Python 3.11 is only needed if you want to run the form check tests or develop without Docker (see below). Make sure nothing else is using ports **5432** (PostgreSQL), **4000** (API) or **8080** (web); a locally installed PostgreSQL is the usual culprit, so stop it first.

```bash
# 1. Get the code
git clone https://github.com/sanjayvasudevan-c/SIH-demo-source-code.git
cd SIH-demo-source-code

# 2. Configuration (the defaults work as they are)
cp .env.example .env                       # Windows PowerShell: Copy-Item .env.example .env

# 3. Install, create the database, migrate, seed the demo data, build the reset template
npm run setup

# 4. Start everything: database, API, two schedulers, form check service, web
docker compose up -d --build
```

Open **http://localhost:8080**, click a demo user on the sign-in page (it fills the email; the password for everyone is `demo1234`) and sign in.

What `npm run setup` does, in order:

1. `npm install` for the API and web workspaces.
2. `docker compose up -d db`: starts PostgreSQL 16; on first start it runs `db/init/00_roles.sql`, which creates the `aicte_migrator` and `aicte_app` roles and the databases.
3. Builds and briefly starts the form check container (it trains its model while the image builds), so the seeded form checks are scored by the real model.
4. Recreates the `aicte` database, applies the Prisma migration and `api/prisma/sql/001_audit_guard.sql` (grants, append-only audit trigger, partial indexes, checks).
5. Seeds the directory and about 190 applications of history (about 30 seconds). At the end it prints counts by stage and status, open flags by reason, utilisation per South officer, the demo users and one **West application id** (keep it for the access-denied demo).
6. Copies the seeded database to the template `aicte_seed`, which `npm run demo:reset` restores in a second.

Running `npm run setup` again wipes and reseeds everything.

### Everyday commands

| Command | What it does |
|---|---|
| `docker compose up -d` | Start the stack (add `--build` after pulling new code) |
| `docker compose ps` | See the containers; there are two `scheduler` replicas |
| `docker compose logs -f api scheduler` | Follow the API and scheduler logs |
| `docker compose down` | Stop the stack (data is kept in the `pgdata` volume) |
| `docker compose down -v` | Stop and delete the database volume (then run `npm run setup` again) |
| `npm run demo:reset` | Put the demo back to the seeded state in about a second (the admin's **Reset demo** button does the same) |
| `npm run demo:tamper` | As the database superuser, edit one audit row behind the trigger's back, for the integrity demo |
| `npm test` | API tests (Vitest + Supertest) against a separate `aicte_test` database on the same PostgreSQL |
| `npm run test:formcheck` | Form check tests (pytest); needs Python 3.11 and `pip install -r formcheck/requirements.txt` |

Reset before each demo run. After a reset the schedulers reconnect on their own (Compose restarts them) and the API carries on.

### Running without Docker (development)

1. Install **PostgreSQL 16** and make sure the superuser `postgres` has the password `postgres` (or change `DEMO_ADMIN_URL` in `.env`). The setup script creates the roles and databases itself.
2. Install **Python 3.11**, then the form check service and its model:
   ```bash
   python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
   pip install -r formcheck/requirements.txt
   python formcheck/training/generate.py && python formcheck/training/train.py && python formcheck/training/evaluate.py
   ```
3. Seed without Docker, then start the API, one scheduler, the web dev server and the form check service together (`npm run dev` calls `python3` for the form check; on Windows, start it yourself with `python -m uvicorn app.main:app --port 8000 --app-dir formcheck`):
   ```bash
   SETUP_NO_DOCKER=1 npm run setup     # Windows PowerShell: $env:SETUP_NO_DOCKER=1; npm run setup
   npm run dev
   ```
   Open **http://localhost:5173**. If the form check service is running on port 8000 while you seed, the seeded checks use the model; otherwise they use the rules fallback (shown as "model unavailable").

### Troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` for 5432 | Another PostgreSQL is running. Stop it, or change the published port in `docker-compose.yml` and the URLs in `.env`. |
| Setup stops at "Database did not become ready" | Docker is not running or the `db` container failed: `docker compose logs db`. |
| `password authentication failed for user "aicte_migrator"` | The `pgdata` volume was created with other passwords. Run `docker compose down -v` and `npm run setup`. If you change passwords, change them in both `.env` and `db/init/00_roles.sql`. |
| Sign-in page shows no demo users | The API is not up yet (`docker compose logs api`) or `DEMO_MODE` is not `true`. |
| The admin Scheduler tab shows no leader | `docker compose ps scheduler`; one of the two replicas becomes leader within about 10 seconds. |
| "Check my entries" says "Model unavailable, rules only" | The form check container is down: `docker compose logs formcheck`. Filing still works; the API uses the rules fallback. |
| Times look off after time travel | Expected: the simulated date is shown in amber in the top bar. `npm run demo:reset` returns to today. |
| First `docker compose up --build` is slow | It builds three images and trains the form check model once; later starts take seconds. |

Default credentials and secrets in `.env.example` are for the demo only. Change `JWT_SECRET` and the database passwords before putting this anywhere but a laptop.

## Live demo (Vercel + Neon)

**https://aicte-demo-website.vercel.app**: open it, pick a demo user on the sign-in card (password `demo1234`), and every screen works. Admin → Reset demo restores the seeded data in under a second.

How the hosted version differs from the compose stack (all switched on automatically by `api/src/lib/hosted.ts` when the Neon integration's variables are present):

| Concern | Compose stack | Hosted |
|---|---|---|
| API | Express process | the same Express app as one Vercel function (`api/src/serverless.ts`) |
| Deadline engine | two scheduler processes, leader by advisory lock | runs after requests (at most once a minute, same lock) and from a daily Vercel cron; time travel runs it immediately |
| Database roles | `aicte_migrator`, `aicte_app` with passwords from `.env` | Neon owner for migrations and reset; the app still connects as `aicte_app` (password derived from the owner's, nothing extra stored) |
| Uploads | files on disk | `StoredBlob` table (`STORAGE_DRIVER=db`) |
| Demo reset | recreate the database from a template | restore a snapshot of the seeded rows (`DEMO_RESET_MODE=snapshot`) |
| Form check service | Python container | not deployed; the app shows "Model unavailable: rules only" and uses the Node rules |
| Tamper demo | `npm run demo:tamper` | not available (it needs direct database access) |

Build: the Vercel project's root directory is `web/`; `web/vercel.json` runs `scripts/vercel-build.mjs`, which migrates, reseeds and snapshots only when the schema or seed changed, then emits `.vercel/output`.

## Demo users

Password for every user: `demo1234`.

| Email | Who |
|---|---|
| college.abc@demo.in | ABC Engineering College (South), portfolio officer Priya Raman |
| priya@demo.in | Priya Raman, officer, South (Kumar's team) |
| arjun@demo.in | Arjun Rao, officer, South (Kumar's team) |
| meena@demo.in | Meena Pillai, officer, South (Kumar's team) |
| ravi@demo.in | Ravi Kumar, officer with the EVC desk skill, South |
| kumar@demo.in | Kumar Sharma, senior officer, South |
| lakshmi@demo.in | Lakshmi Iyer, super senior officer, South |
| hod.south@demo.in | Dr. Rajesh Menon, head of department, South |
| authority.south@demo.in | Competent authority, South |
| committee1@demo.in … committee6@demo.in | Expert committee pool (cross-region) |
| bureau.head@demo.in | Bureau head (cross-region) |
| officer.west@demo.in | Rahul Patil, officer, West |
| admin@demo.in | Administrator (time travel, reset, audit; reads the Rules Center; "Ignore schedule (demo)") |
| rules.editor@demo.in | Ravi Narayanan, Deputy Director, Regulation Bureau: drafts rule amendments (maker) |
| rules.approver@demo.in | Dr. Kavita Rao, Director, Regulation Bureau: reviews, approves and publishes them (checker) |

## Demo script (after `npm run demo:reset`)

1. Sign in as ABC Engineering College (`college.abc@demo.in`). Start a new institution application. Enter a built-up area larger than the land area: "Check my entries" shows R1 (High); fix it. If a Medium warning remains, enter a justification. Try to submit without the land lease (blocked; the message names it); attach it with an expiry 2 years ahead and submit. Priya's case view shows "Assigned to Priya Raman … portfolio officer".
2. Sign in as Priya. Open the case from My tasks; the Form checks panel shows the history (mark the earlier R1 warning useful). Return it with "Lease covers 2 years, 3 required" and the land lease item. The case turns amber, the clock pauses, it leaves her own list and appears under "Waiting on college" after the next engine cycle (up to a minute).
3. Sign in as the college and reply with a new lease (3 years). Re-scrutiny returns to Priya with the remaining days.
4. Priya completes scrutiny. The EVC desk task goes to Ravi with its reason text.
5. Admin advances 20 days. "EVC not scheduled" appears; escalation level 1 reaches Kumar.
6. Sign in as Kumar. Team: per-officer figures, waiting-on breakdown, Escalated to me. Workforce: Arjun overloaded, Meena idle. Availability: add leave for Arjun starting today; his open tasks are reassigned (Meena takes the largest share), each with reason text. Workforce: reassign one task by hand and see "Recommended by system".
7. Sign in as Ravi: open the EVC case, review the proposed committee, schedule for tomorrow, online. Admin advances 1 day. Sign in as the first committee member and submit the report. The case reaches Decision.
8. Sign in as `authority.south@demo.in`: approve with conditions, "Submit fire NOC" due in 90 days.
9. Admin advances 85 days. The college sees reminders at 30, 15 and 7 days (each once), and Priya sees the expiring lease in her portfolio under "Waiting on college". The college uploads the fire NOC on Compliance; the verification task goes to Priya; she verifies on the case; the case becomes Closed.
10. Admin: filter the audit log by the application number (every step is there) and run Verify integrity (OK). Try an update as the app role (below): rejected. Run `npm run demo:tamper` and verify again: the broken row is named. Sign in as a South officer and open `/cases/<West id>` (the seed prints one): no access, logged as ACCESS_DENIED. Run `docker compose stop` on the leader scheduler (`docker compose ps scheduler` lists both; the admin Scheduler tab names the leader): the standby becomes leader within a minute and no alert repeats.

11. Rule change. Sign in as `rules.editor@demo.in` and draft an amendment to 2027–28, "Corrigendum (prototype)". On Documents add a critical "Fire safety audit report" for new institutions; on Schedule extend the application window by 14 days; save. Under "Apply to", mark both changes "Live cases too" and submit: the document change is refused ("Adds the critical document …; can only apply to new cases"). Set it back to new cases only. Impact says no filed case is affected, how many of the last 50 filings would now miss the document, and that the window is extended for all groups. Submit for review; sign in as `rules.approver@demo.in`, open Review, approve and publish. As ABC Engineering College the banner reads "1 change to the 2027–28 rules since your last visit"; the notice shows the summary and its source. The case filed in step 1 still shows "rules 2027–28 v1" and needs no new document; a new application files under v2 and its checklist includes the fire safety audit report. Admin → Audit log, chain "Rules Center": drafted, edited, submitted, approved, published; Verify integrity passes for the rules chain. Back in the Rules Center, open v1 and choose "Roll back to this version": version 3 is created as a draft with v1's content, for the approver to publish; cases filed under v2 stay on v2.

This script (steps 1–11) is automated with Playwright during development and passes end to end twice in a row after a reset.

## Phase status

- [x] Phase 0: foundation (compose stack, roles and audit guard, schema, config, clock, workdays, audit chains, auth, policy skeleton, directory seed, template and reset, design system and shell)
- [x] Phase 1: workflow and assignment (routing, transitions, assignment engine with reasons, availability, uploads, role screens)
- [x] Phase 2: deadline engine and scheduler (deadline items, pause and resume, leader election, reminders, overdue, escalation, digests, time travel, admin controls)
- [x] Phase 3: Action Center and dashboards (flags with reasons and five-key order, college "What we need from you", team roll-up with drill-down, workforce with reassignment and portfolio moves, no-eligible-officer queue, seeded history)
- [x] Phase 4: post-approval and form check (decide with conditions, undertakings and expiry items, evidence and renewal verification, automatic close, form check service with rules and an Isolation Forest, college and officer panels)
- [x] Add-on: yearly rule packs (cycles, versions and amendments; maker-checker Rules Center; pinning; live rebase for relaxing changes; impact preview; public notices)
- [x] Add-on: GIGW-style interface (AICTE Demo Website shell, public pages, high contrast, text sizes, Hindi, self-hosted fonts, screenshots)

## Modules

**Workflow.** Each application type has a route, defined in the rule pack the case is pinned to, resolved at submission and stored on the case. A case is one record with a moving pointer: stage, status and holder. Every action goes through `performAction`, which validates the payload, checks `can(user, action, application)` (role, scope, transition table, current holder or assignment, separation of duties), then runs one database transaction that changes the case, moves assignments, updates deadline items, appends the audit row and creates notifications. There is no approve or reject anywhere except the competent authority's Decide.

**Assignment.** When a stage needs an officer, the engine locks the region, loads eligible officers with their live load from open assignments, drops anyone away, over capacity, barred or recused, prefers continuity (the institution's portfolio officer for scrutiny and verification, the returning officer for re-scrutiny), and otherwise picks the lowest score (0.70 projected utilisation, 0.20 recent assignments, 0.10 specialisation mismatch). If no officer in the region qualifies it overflows to the Bureau; if nobody qualifies the task goes to the head of department's queue. Every assignment stores a plain-language reason ("Assigned to Priya Raman (Officer, South): portfolio officer for ABC Engineering College; utilisation 0.15 after this task. 50 eligible; none excluded. Tier 0. Rules 2027-28 v1."). Leave covering today releases and reassigns an officer's open tasks without moving deadlines.

**Action Center.** Each engine cycle rebuilds a set of flags from the deadline items and case state: at risk, overdue, waiting on college, stalled, EVC not scheduled, EVC report overdue, evidence waiting for verification, undertaking due soon or overdue, document expiring or expired, blocked (missing critical document, no committee for a due EVC, no eligible officer), urgent and escalated. Each flag has an owner, a next action and a reason in plain language ("Overdue — Scrutiny deadline 4 working days overdue (due 6 Nov 2026); owner: Priya Raman (Officer, South); waiting 19 days; next: Complete stage, return or revert; next escalation: level 2 (Deputy Director) on 18 Nov 2026"). The list is always ordered by escalation level, days overdue, category (new institutions first), days to due and filing date. Flags owned by a college never count as an officer's overdue work; they appear under "Waiting on college" and on the college's own "What we need from you" card. No machine learning is involved.

**Reports and workforce.** Senior officers, super seniors and heads of department see their direct reports' work received, completed, returned and held, ageing in stage, overdue items, deadlines met and utilisation, with each person's figures summed over everyone who reports to them and a drill-down to the next level. There is no ranking and no composite score. The workforce view shows each officer's load against capacity, availability today, open tasks and portfolio, flags overloaded and idle officers against their own team's average, and lets the manager reassign a task (the system's recommendation is shown and recorded) or move a portfolio.

**Deadline engine and scheduler.** Every clock is a deadline item written inside the case transaction: stage deadlines in working days, the EVC scheduling and report deadlines, verification, undertakings and document expiry in calendar days. Returning a case pauses its clock and stores the remaining working days; the reply resumes it. Two scheduler processes run; the one holding a PostgreSQL advisory lock is the leader and runs a cycle every minute (the other waits and takes over within seconds if the leader stops). A cycle sends compliance reminders at 30, 15, 7 and 0 days, an at-risk alert at 80% of a stage deadline, an overdue alert, and escalations at 3, 7 and 14 days overdue up the `reportsTo` chain (HoD when the chain ends; the competent authority also at level 3). A unique key on every alert makes cycles idempotent, so a scheduler that was down catches up once, marking missed reminders late. Weekends and holidays are skipped. The admin's time travel moves a simulated clock that every date comparison uses, and runs a cycle at once.

**Post-approval compliance.** An approval with conditions creates one undertaking (with a deadline item) per condition, and every verified document with an expiry date gets an expiry item. Colleges upload evidence or a renewed document from the Compliance page; the engine assigns a verification task (preferring the portfolio officer) with a 5-working-day clock. Verified evidence closes the undertaking; when the last one is verified the case closes automatically. Rejected evidence goes back to the college with the officer's remarks. A verified renewal replaces the expiry item.

**Form check ("Check my entries").** While a college fills the form, the API checks required fields itself and asks the Python service for a score (800 ms timeout). The service applies five plausibility rules (built-up area larger than the plot, expired lease, fewer than 80% of required documents, more than 40 students per faculty member, less than 2 square metres per student) and an Isolation Forest trained on synthetic normal forms; rule hits are HIGH, a model-only anomaly is MEDIUM and names the three most unusual values with their typical values. The rules and their thresholds (norms) come from the case's rule pack and are sent with every request; if the service is down, the API evaluates the same rules itself and marks the result "model unavailable". Warnings never block filing and never affect routing, deadlines, assignment or Action Center order; HIGH and MEDIUM warnings only ask the college for a justification, which the scrutiny officer sees alongside the check history and can label useful or not useful (stored with the model version). Evaluation figures in `formcheck/EVALUATION.md` are measured on synthetic data only.

**Audit.** Every action appends a row to `AuditLog`. Rows are chained per application (and one global chain for non-case events): each row stores `sha256(prevHash + canonicalJSON(row))`, with a per-chain advisory lock so concurrent cases never block each other. The app role has no UPDATE, DELETE or TRUNCATE on the table, and a trigger rejects updates and deletes even from the owner. `GET /api/admin/audit/verify` recomputes every chain, names the first broken row and lists every broken chain. Rule pack events have their own chain, `rules`.

Try an update as the app role (rejected with "permission denied"):

```bash
docker compose exec db psql -U aicte_app -d aicte -c "UPDATE \"AuditLog\" SET reason = 'x' WHERE id = 1"
```

## How yearly rule changes work

**Cycle.** An approval cycle is one academic year, for example 2027–28, with the handbook it is based on. Each cycle has one rule pack: application types and routes, documents, norms, form check rules, timelines, fees, letter templates, the application schedule, reminders, escalation, assignment weights, committees and holidays, all in one validated JSON document.

**Version.** A rule pack has numbered versions. Version 1 is the base; each later version is the previous one plus one amendment. A version moves Draft → In review → Approved → Published → Superseded (or Rejected, back to its maker). Once it leaves Draft its content cannot change, a database trigger enforces this, and only one version per cycle is published at a time. History is never edited.

**Amendment.** Each version records its source: an addendum, corrigendum, public notice, circular, academic calendar or fee notification, with its reference number, issue date, effective date and a plain-language summary for colleges. Every rule that came from a document can cite it ("Addendum 04 Dec 2025 (modelled), cl. item 1"); the Rules Center shows these as chips and the public notices page lists every amendment with its summary.

**Pinning.** When a college submits, the application stores the published version of the cycle whose application window is open. Everything that defines the case (route, documents, norms, form check, timelines, letters) is read from that version for the life of the case, so a new required document never invalidates a case already filed. Operational settings (schedule, reminders, escalation, assignment weights, committees, holidays) always come from the cycle's current published version.

**New cases only, or live cases too.** Every change applies to new filings. A change may also apply to live cases only when the system can prove it relaxes the rules: a later date, a longer period, a document made optional or removed, a norm moved in its relaxing direction, or a purview or eligibility condition that only widens (checked against every institution and open case). Anything else marked live is refused with the path and the reason. On publish, open cases pinned to the previous version move forward one transaction each; their deadlines can move later and never earlier, and each move is audited and notified.

**Maker-checker.** Rule editors draft, edit, import and submit; rule approvers review, approve or reject with remarks, and publish (now, or scheduled for the effective date). An approver cannot approve a version they created or edited. The impact preview, a read-only dry run, shows which cases would move, what would change for recent filings, form check hit counts, utilisation and who can file today, in plain sentences.

**Rollback.** Rolling back drafts a new version whose content equals an older one; it goes through the same review and publication, and the older and newer versions both stay on record. Cases keep the version they are pinned to.

## What is placeholder

Every value in the seeded rule packs is a placeholder until it is checked against the Approval Process Handbook 2024–27, its addenda and the public notices on the official AICTE website. That covers:

- application types, routes and which ones need an earlier approval;
- the document lists and which documents are critical;
- the norms: compliance period (6 months), minimum lease (3 years), 40 students per faculty member, 2 square metres per student, 80% of required documents, the 50% intake increase that needs an expert visit, and the foreign-national supernumerary percentages (15 / 25 / 25);
- the timelines (scrutiny 15, SAC/SHC 10, decision 7, EVC scheduling 10, EVC report 5, verification 5 working days), reminder offsets, the at-risk percentage and the escalation thresholds;
- fees and late fees (shown only; the prototype takes no payments);
- the 2026–27 windows, and the 2027–28 window, which runs from 7 days before to 60 days after the seed date so the demo can file;
- committee appointing authorities and sizes, and the holiday list;
- the assignment weights, capacities and score weights;
- the letter templates.

Versions 2 and 3 of 2026–27 are labelled "modelled on" the December 2025 addendum and the February 2026 revised public notice as publicly reported. They are not copies of those documents.

## Interface

The interface follows the visual language of Indian government portals built to GIGW 3.0. It does not use their identity.

**Layout.** Public pages (home and sign in, Approval process, What changed, Track application, Help, Contact and the policy pages) have:
- a slim dark utility bar;
- a white header with the bilingual name block ("एआईसीटीई डेमो वेबसाइट / AICTE Demo Website") and our own "AD" monogram;
- a navy navigation bar with a saffron underline on the active item;
- a static "What's new" strip with the three latest rule notices;
- a four-column dark footer with a "Last updated" line and the rules version in force.

After sign-in the same utility bar sits above a compact header; the left sidebar and the work screens are unchanged. Every page carries the label "Prototype for Smart India Hackathon 2026 · Not an official AICTE system": in the utility bar, on the sign-in card and in the footer.

**GIGW features.**
- **Skip link and screen readers:** "Skip to main content" is the first focusable element, and a Screen reader access page lists NVDA, JAWS, VoiceOver, TalkBack and Orca.
- **Text size:** A- / A / A+ (and A++ on public pages) set the root size to 87.5 / 100 / 112.5 / 125%; the layout is in rem, so everything scales.
- **High contrast:** the same light layout with black text, darker colours, underlined links and black borders on form controls.
- **Language:** English | हिंदी. Hindi covers the shell, navigation, public pages, notices, sign in, Rules Center labels, status badges and common buttons; case data stays as entered, and any missing key falls back to English.
- **Pages GIGW expects:** an accessibility statement, a sitemap generated from the router, and terms, privacy, hyperlinking and copyright policies, each marked "Prototype text".

The text size, contrast and language choices are remembered in the browser.

**Tokens.** Colours are CSS variables (`gov-ink` #0B2545, `gov-nav` #13315C, `gov-saffron` #F59E0B for non-text marks only, `accent` #1B4F9C). Corners are squarer (4px controls, 6px cards), and there are no shadows except dialogs and menus. Fonts are Noto Sans and Noto Sans Devanagari, self-hosted with `@fontsource` and bundled by Vite: no font CDN and no external requests.

**Accessibility checks.** axe reports no serious or critical issue on the 13 public pages (English, Hindi, high contrast and 125% text, at 1440 and 390 px wide, with no horizontal scrolling), nor on the officer, manager, college, Rules Center and admin screens in English, Hindi and high contrast.

**Screenshots.** `npm run screens` captures home, notices, Action Center, case view, team dashboard, Rules Center versions, diff, impact and review at 1440×900 and 390×844, in English and Hindi, into `docs/screens/`. It runs against the compose stack by default (`BASE=http://localhost:5173` for the dev server). It may leave one draft in review for the impact and review shots; `npm run demo:reset` removes it.

**No official marks.** There is no AICTE logo, no State Emblem of India, no national flag as decoration, no ministry or event logos, no "Government of India" identity and no text copied from aicte.gov.in. The name, monogram and all text are our own.

## Next phases (not built)

Phase 5: rebalancing suggestions and approval, full committee coverage and independence rules, delegation grants, conflict-of-interest editor, case lock. Phase 6 (the rules, policy and letter-template editors with versioning, impact preview and approval are built by the rule pack add-on): model editor, case summary PDF, report export, model shadow mode and feedback export. Phase 7: OCR document cross-check and units selector. Phase 8: PgBouncer, read replica, partitions, row-level security, TOTP, SSO, encryption at rest, virus scan, email and SMS (a `NotificationChannel` interface exists with only the in-app implementation), Hindi for the remaining work screens, integration adapter.
