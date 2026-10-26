# Decisions

Choices made where the build spec was silent, plus the design review recorded at the end of each phase.

## Phase 0

- **Repository layout.** The spec's `aicte-platform/` folder is the repository root, so `docker compose up` and `npm run …` run from the top of this repo.
- **Node version.** Containers use Node 20 as specified. The code also runs on Node 22 (used in the build sandbox).
- **Local Postgres.** `npm run setup` starts the compose `db` service by default. `SETUP_NO_DOCKER=1 npm run setup` uses any Postgres 16 reachable through the URLs in `.env` (used in the build sandbox).
- **Database URLs.** `DATABASE_URL` (aicte_app) is used by the API and scheduler, `MIGRATOR_URL` (aicte_migrator) by migrations and the seed, `DEMO_ADMIN_URL` (postgres superuser) only by demo reset, demo tamper and the template build. Role passwords in `db/init/00_roles.sql` are the `.env.example` defaults; change both together.
- **Database names are configurable** (`APP_DB_NAME`, `TEMPLATE_DB_NAME`, defaults `aicte` and `aicte_seed`) so the test suite can use `aicte_test` / `aicte_test_seed` with the same reset code.
- **Demo reset** uses `DROP DATABASE … WITH (FORCE)` (PostgreSQL 13+) to end other sessions, then `CREATE DATABASE aicte TEMPLATE aicte_seed`. The API disconnects Prisma first and reconnects afterwards; schedulers exit on the dropped lock connection and compose restarts them.
- **Clock refresh.** `clock.now()` is synchronous and uses a cached `SimClock.offsetDays`. The API refreshes the cache after time travel and reset, and at most every 5 seconds from request middleware; the scheduler refreshes it at the start of every cycle.
- **`clock.advance(days)`** only moves the offset. The synchronous engine cycle after time travel lives in `engine/timeTravel.ts` (to avoid a circular import between `lib/clock.ts` and the engine).
- **"Today" is UTC**, as specified. Display uses IST for times.
- **Working-day arithmetic.** `addWorkingDays(d, 0)` returns `d`; `workingDaysBetween(a, b)` counts working days in `(a, b]` (negative when `b < a`). "Days to due" for working-day items is `workingDaysBetween(today, due)`.
- **Holidays.** The seed adds six placeholder holidays falling in the six months after the seed date, chosen from a fixed list of national and South Indian holidays (weekday dates first).
- **Login rate limit** counts failed attempts only (`skipSuccessfulRequests`): 10 failed attempts per 15 minutes per IP. Counting successful logins too would lock out a live demo that switches between a dozen users.
- **Stay signed in.** Added `POST /auth/refresh`, which exchanges a still-valid token for a fresh 8-hour token. The client warns 2 minutes before expiry.
- **ACCESS_DENIED rows** go to the global audit chain with the application id in `meta`, so a refused request never writes into a case chain the user cannot see.
- **Audit `verifyChains()`** loads all rows in id order; enough for demo scale (partitioning and streaming are phase 8).
- **Admin scope.** ADMIN has no application scope (`/applications` returns nothing); case history is read through the admin audit log, filtered by application number.
- **Formcheck stub (phase 0)** returns 503 on `/health` and `/score`, so `/health` on the API reports `formcheck: "down"`.
- **Container builds** could not be run in the build sandbox (no package mirror access from build containers). The compose stack is standard and builds on a normal machine; all behaviour was verified with the same services run as local processes against PostgreSQL 16.

### Design review, phase 0

| Check | Result |
|---|---|
| One primary action per view | Login: "Sign in" only. Placeholder pages have none. Style guide shows variants deliberately. |
| Tokens only | All colours, sizes, radii and shadows come from `tailwind.config.ts`; the theme replaces Tailwind's palette so no other colour classes exist. No arbitrary values (`-[…]`) in the client. |
| Tables for lists | `Table` is the only list component; card grids are used for stat tiles only. |
| Sentence case | All strings in `strings/en.ts` are sentence case. |
| Status never colour-only | `StatusBadge` always pairs an icon and a label; `Tracker` adds icons and screen-reader state text. |
| Loading, empty, error | `Table`, `Skeleton`, `EmptyState`, `ErrorState` in the style guide. |
| Keyboard path | Skip link, visible 2px focus ring, tabs and segmented control with arrow keys, dialogs trap and return focus, Escape closes dialogs and menus, rows open with Enter. |
| Nothing from 11.6 | No gradients, shadows only on overlays, radius 6/8px, system font, no emoji or "AI" labels. |
| axe | Login, all 13 named landing pages and the style guide: 0 serious or critical issues (axe-core via Playwright). |

## Phase 1

- **RETURN releases the scrutiny assignment** (transition table: "release assignment (RETURNED) and remember previousOfficerId"), so the officer's capacity is freed while the college holds the case. Section 2.3 says the assignment "stays open"; the transition table was followed. The paused stage item stays the responsibility of the officer who returned it.
- **Deadline items are written by the phase 1 transitions** (stage clocks, pause and resume, EVC schedule and report items) because the actions and their side effects are one transaction. Phase 2 adds the engine that reads them.
- **Required documents for the form check's `docs_ratio`** are the critical documents of the type. `docs_ratio` is unknown (rule R3 skipped) until the applicant reaches the documents step.
- **Hard validation** at submission (and in `/forms/validate` as `requiredMissing`): at least one course with intake and the faculty count for every type; land area, built-up area, laboratories and lease expiry for types whose checklist includes the land lease; intake increase for INTAKE_INCREASE; proposed name for NAME_CHANGE.
- **A submission without an earlier form check** runs one at submit time so every application is linked to a FormCheckResult.
- **Uploads on submit and reply** are multipart: `files[]` plus a `fileMeta` JSON array of `{kind, expiryDate}` in the same order. Critical documents that have an expiry must carry an expiry date.
- **Scrutiny completion verifies the documents on file** (sets `verified`, `verifiedById`), which is what DECIDE uses for the DOC_EXPIRY items.
- **REPLY uploads supersede** the earlier document of the same kind (`supersedesId`); the case view shows the current version and how many it replaces.
- **SUBMIT_EVC_REPORT** is accepted on or after the visit date. The recommendation values are `RECOMMEND_APPROVAL`, `RECOMMEND_CONDITIONS`, `RECOMMEND_REJECTION` and are advisory.
- **SUBMIT_RECOMMENDATION** (SAC/SHC) may be submitted by any committee member once the case is forwarded.
- **Assignment availability rule.** An officer is unavailable when a period covers today and, for non-urgent tasks, also the next working day (urgent tasks need today). Urgent = the task's deadline item is due within 3 working days or overdue.
- **Bureau overflow** takes both the region lock and `assign:bureau`, because the Bureau pool is shared across regions.
- **No-eligible-officer queue** is the set of open BLOCKED flags whose `sourceItemId` is `assign:<TASK>:<ref>` and whose task still has no open assignment. HoD (region) and Bureau work it through `POST /assignments/unassigned/assign` (added; the spec lists the queue but no endpoint to take a task from it).
- **Manual reassignment eligibility.** The target must be eligible for the task type (tier 0 or tier 1 role, skill) and pass every hard filter; the engine's own pick (excluding the current holder) is stored as `recommendedOfficerId`.
- **Specialisation mismatch** counts any assignment in the last 30 days on an application of the same category.
- **"Recused"** is a released assignment with reason `RECUSED`; there is no recusal action until phase 5, so the filter exists but never fires.
- **Application numbers** are `S-2026-0001` / `W-2026-0001` (region letter, year of the simulated clock, running number).
- **Colleges see a desk, not a name** ("Scrutiny officer, South"), and their case history omits internal workload events (assignments, releases, escalations, labels).
- **After an action that moves the case off the user's desk** (for example scheduling releases the EVC desk task), the client returns to the user's home page with a confirmation instead of showing "no access".
- **`GET /assignments/my-load`** (added) feeds the officer's utilisation bar.

### Design review, phase 1

| Check | Result |
|---|---|
| One primary action per view | Case view: the first permitted action is primary, Return is destructive, the rest secondary. Apply: Continue or Submit. College home: Start a new application. |
| Tokens only | New width tokens (`w-num`, `min-w-content`, `h-table`) live in the config. No arbitrary values. |
| Tables for lists | Applications, tasks, queues, deadlines, history and availability are tables. |
| Sentence case | Yes. Buttons name the result ("Return to college", "Complete scrutiny", "Schedule visit"). |
| Status never colour-only | Status badges carry icon and label; the tracker has icons and screen-reader state. |
| Loading, empty, error | Every list uses `Table` states; case views show skeletons and an error state with retry. |
| Keyboard path | Rows open with Enter; dialogs trap focus; the apply form has an error summary that takes focus and links to fields. |
| Nothing from 11.6 | Checked. The form check is "Check my entries" everywhere. |
| axe | College home, apply, college case, officer, case view (officer and authority), EVC, committee, authority, Bureau and availability: 0 serious or critical issues. |

## Phase 2

- **Two advisory locks.** Leadership uses session lock `727001`, held by the leader scheduler on its dedicated `pg` connection for its whole life. Every engine cycle additionally takes lock `727002` on a short-lived dedicated connection. The leader takes it every minute; the API takes it for the synchronous cycle after time travel, waiting up to 10 seconds. This is how "the same leader lock" is honoured without the API ever becoming leader, and it guarantees cycles never overlap.
- **Scheduler instance ids** are `hostname-pid`. A new leader clears `isLeader` on every other heartbeat row, so a leader that was killed (and could not clear its own flag) never shows as a second leader. The admin panel treats an instance as "not reporting" when its heartbeat is older than 150 seconds.
- **AlertLog trigger dates.** For reminders, `triggerDate` is the date the offset was meant for (`due − offset`); `late` is true when that date is more than one day before today. For at-risk it is the day it fired; for overdue and escalation it is the due date.
- **Several levels at once.** If an item jumps past more than one escalation threshold in a single cycle (time travel), each level fires once, in order, with its own notification and audit row.
- **Escalation targets.** Walk `reportsToId` N steps from the responsible user; if the chain ends first (Bureau head, committee member, authority), the region HoD is notified. Level 3 also notifies the region's competent authority.
- **Availability that begins** (engine step 6) releases an officer's open tasks only when the officer is also away on the next working day, or the task is urgent — the same horizon rule the engine uses when assigning, so tasks never bounce back and forth. Availability created through the API that covers today releases every open task, as specified.
- **Digest counts.** X = OVERDUE alerts created in the last 24 hours (simulated time) for items whose responsible user is in the manager's subtree; Y = ESCALATED audit rows in the last 24 hours that notified the manager; Z = stalled cases held by the manager's subtree. The dedupe row uses a negative item id derived from a hash of the user id.
- **Stalled** = IN_STAGE, no audit action for 10 working days (`lastActionAt`), and no open stage-type item overdue.
- **ALERTS_SENT** is written once per cycle when anything was sent or released, with the counts and the instance id (or `time-travel`).
- **Time travel** returns the new date and the cycle counts; the admin screen shows both.

### Design review, phase 2

| Check | Result |
|---|---|
| One primary action per view | Audit log: Verify integrity. Demo controls: no primary (time travel buttons are equal choices; Reset is destructive and confirmed). |
| Tokens only | Yes. |
| Tables for lists | Audit log and scheduler instances are tables; the directory is a tree (hierarchy, not records). |
| Status never colour-only | Leader / Standby / Not reporting badges have dots and labels; verify result has an icon and text. |
| Loading, empty, error | Tables use the shared states. |
| Keyboard path | Tabs with arrow keys; scrollable table regions are focusable. |
| axe | All four admin tabs: 0 serious or critical issues (after making scrollable table regions focusable). |

## Phase 3

- **Flag owners.** Stage-type flags are owned by the item's responsible user (the officer holding the task, the EVC desk officer, the first committee member for EVC reports, the region authority for decisions). Undertaking and document flags are owned by the college (`ownerRole COLLEGE`, no owner user); the portfolio officer is named as follow-up in the reason text when they are overdue. ESCALATED is owned by the level-N manager. BLOCKED (no eligible officer) is owned by the region HoD.
- **An undertaking with evidence submitted** is not the college's to act on, so it raises no due-soon, overdue or urgent flag for the college while it waits for verification (EVIDENCE_PENDING_VERIFICATION covers the officer side).
- **BLOCKED conditions implemented:** no eligible officer (kept while the task is unassigned); a critical document with an expiry (the land lease) that has expired on an open case ("needed for the next stage"); an EVC schedule due within 3 working days when fewer than 3 committee members are available on the next working day ("EVC due without committee proposal").
- **URGENT** is raised for any open item due within 3 days (working days for stage items, calendar days for compliance items), not when already overdue (overdue has its own flags).
- **Flag rows are upserted by `(applicationId, reasonCode, sourceItemId)`**; a flag that comes back after being resolved reopens with a new `raisedAt`. Each resolution writes a `FLAG_RESOLVED` audit row on the case chain.
- **The Action Center lists one row per application**, showing its highest-priority flag (by the five sort keys) and badges for the others. Columns: application no, institution, task, days in stage, status, and "why and what next" (the next action in bold above the reason text), which keeps the table within 7 columns.
- **Filters:** Mine (flags owned by me, never college-owned), Waiting on college (college-owned flags on cases in my scope), Escalated to me. Colleges see their own college-owned flags ("What we need from you").
- **Officer scope** now also includes a case the officer returned while the college replies (`status RETURNED` and `previousOfficerId` = officer), so it shows under Waiting on college.
- **Summary cards:** held = my open assignments; due this week = my open stage-type items due within 5 working days; overdue = my overdue-type flags (college-owned excluded); waiting on college = cases with college-owned flags in my scope.
- **Team report.** Received = assignments to the person's subtree in the period; completed = COMPLETE_STAGE, FORWARD_SAC_SHC, VERIFY_EVIDENCE and VERIFY_RENEWAL by them; returned = RETURN by them; closed = their portfolio's cases decided or closed in the period; overdue now = their open stage-type items past due; SLA met % = MET ÷ (MET + MISSED) for stage-type items closed in the period; average working days per stage = stage deadline items closed in the period (created → closed). Ageing buckets count distinct held cases by working days in the current stage. Waiting-on counts open cases in the caller's scope by holder.
- **Workforce team average** for IDLE is the average utilisation of officers with the same senior. Bureau sees every officer and Bureau member.
- **Reassign options** (`GET /assignments/:id/options`, added) list the engine's own recommendation (region-wide, so it may name someone outside the manager's team) and the officers the manager may choose: their subtree (senior, super senior), their region plus Bureau (HoD), anyone (Bureau), with the reason any of them is blocked.
- **Seed history (section 12)** is built in phase 3 because the phase 3 checkpoint needs it. Choices: ABC Engineering College has no applications (it is a known institution with a Permanent ID; NEW_INSTITUTION is allowed); earlier approvals for extension-type filers are verification visits approved months ago; every application has its linked form check (so there are about 180 results, 18 with HIGH warnings in phase 3; MEDIUM ones arrive with the model in phase 4); a balancing pass gives officers below 3 points one more extension-type application where they have an earlier-approved institution, so the region carries realistic load (186 applications in total).
- **"Mostly to Meena."** When Arjun goes on leave, the engine spreads his 7 tasks by score: Meena (idle, but with the 0.1 specialisation-mismatch penalty for a category she has not handled in 30 days) takes the largest share (3), the rest go one each to the least-loaded officers. The policy weights were left as specified.
- **Seed timing.** The seed runs a light engine cycle (no flags or digests) every fifth working day of the backdated history, skips cycles on the two short windows where availability is staged (so the staged leave does not release unrelated tasks), and finishes with a full cycle at real time.

### Design review, phase 3

| Check | Result |
|---|---|
| One primary action per view | Action Center and team have none (read and triage views); dialogs have one primary. |
| Tokens only | Chart colours are read from the Tailwind theme (`lib/chartTokens.ts`); new tokens `h-chart`, `min-w-reason`. |
| Tables for lists | Action Center, tasks, direct reports, officers and the no-eligible-officer queue are tables; the escalated list is a short list inside a card. |
| Status never colour-only | Badges carry dots or icons and labels; the chart repeats the totals in text. |
| Charts | Flat stacked bars, light gridlines, 12px muted axis labels, three colours (neutral, warning, danger), exact values in the tooltip, totals alongside. |
| Max 7 columns | Action Center reduced to 6 columns. |
| axe | Team (senior and HoD), workforce (senior, HoD, Bureau), officer Action Center, college home: 0 serious or critical issues. |

## Phase 4

- **Compliance actions live in `workflow/actions.ts`** (`uploadEvidence`, `verifyEvidence`, `uploadRenewal`, `verifyRenewal`), each one transaction with its audit row (`UPLOAD_EVIDENCE`, `VERIFY_EVIDENCE`, `UPLOAD_RENEWAL`, `VERIFY_RENEWAL`, and `CLOSED` when the last undertaking is verified).
- **Evidence documents** are stored as kind `UNDERTAKING_EVIDENCE` on the application and marked verified with the undertaking.
- **Rejected evidence** returns the undertaking to OPEN with the officer's remarks; its due date and reminders continue. Rejection needs remarks.
- **Renewals.** Only after approval, only for the current version of a document with an expiry, one pending renewal at a time, new expiry in the future. A rejected renewal is withdrawn (detached from the application) so the college can upload a corrected one; the old expiry item keeps running.
- **No college flag while something waits for verification** (submitted evidence or a pending renewal); the officer side has the VERIFICATION item and, when it is late, EVIDENCE_PENDING_VERIFICATION.
- **Check history on the case.** At submission every form check of the draft is linked to the application (the justification is stored on the latest), so the officer's Form checks panel shows the warnings the college saw and fixed, and any of them can be labelled.
- **Model features.** The eleven section 9.2 features; areas, counts, square metres per student and students per faculty are `log1p`-transformed for the model (missing values imputed with the training median). Explanations use robust z-scores on the untransformed values with the median as the typical value. Python rounds like JavaScript (half up) so the rule values match the Node evaluator.
- **Model limits, stated in EVALUATION.md.** An Isolation Forest trained on normal forms scores a value beyond the training range about like the most extreme normal values, so model-only recall is modest (about 12% on the synthetic faults, 2.2% false alarms); the rules carry the known faults and the model adds unusual combinations. The policy (200 trees, 256 samples, 97th percentile) was kept as specified.
- **Parity samples.** `api/scripts/formcheck-samples.ts` writes `shared/formcheck-samples.json` (50 drafts with the Node rule hits); a Vitest test and a pytest test both check against it.
- **Seeding with the model.** `npm run setup` starts the form check container with a port published on 127.0.0.1 for the duration of the seed only, so seeded form checks are scored by the real model; without Docker the seed uses `FORMCHECK_URL` if reachable, else the rules fallback (marked "model unavailable").
- **Seed additions:** two cases closed after verified evidence, and two with evidence waiting beyond the 5-working-day verification clock (EVIDENCE_PENDING_VERIFICATION), bringing the total to 192 applications.
- **Robustness found by the end-to-end run.** The API retries a model operation once when its pooled connection was terminated (a command-line demo reset recreates the database under the running API). The client ends a session only on a real 401 from `/auth/me`, not when a request is aborted by navigation.

### Design review, phase 4

| Check | Result |
|---|---|
| One primary action per view | Compliance: per-row upload buttons, primary inside the dialog. Verification panel: Verify is primary, Reject is destructive and confirmed with remarks. |
| Tokens only | Yes. |
| Tables for lists | Undertakings and documents with expiry are tables. |
| Status never colour-only | Verified, waiting for verification, overdue, expiring, valid: all badges with icons and labels; countdowns in text. |
| Plain language | "Upload evidence", "Upload renewal", "Verify", "Reject with remarks"; the form check is "Check my entries", never "AI". |
| axe | Compliance, college home and case, officer Action Center and case (with verification), style guide, admin: 0 serious or critical issues. |

## Add-on A1: rule pack schema and expressions

- Expressions are a JSON-logic subset (`var == != < <= > >= and or ! in if + - * / min max`), written twice: `api/src/rules/expr.ts` and `formcheck/app/expr.py`. No type coercion; a missing variable or division by zero gives `null`; depth is capped at 8 and size at 2048 bytes. Both suites run the same `shared/expr-conformance.json` (77 cases, 6 invalid).
- Known variables live in `shared/expr-vars.json`; `norms.<key>` resolves only to norms defined in the same pack.
- `api/src/rules/schema.ts` holds the zod pack schema plus cross-field checks (types referenced by documents and fees exist, routes end with DECISION and repeat no stage, windows run forwards, score weights add up to 1, escalation thresholds increase, holidays fall inside the cycle span 1 July to 30 June, letter placeholders come from a fixed list, no duplicate keys). Errors are `[{path, message}]` for the editor.
- `shared/rulepack.schema.json` is generated (`npm run rules:schema --workspace api`) for external editors; the zod schema is the source of truth.

## Add-on A2: data model, guard, roles, migration, service

- `ApprovalCycle`, `RulePackVersion` and `Amendment` are new tables. `Application.cycleId` and `rulePackVersionId` are added as nullable columns. `scripts/migrate.ts` runs `migrate-from-json.backfillExisting` (an older database gets 2026-27 v1, published by SYSTEM, and every case and assignment is pinned to it). `prisma/sql/002_rulepack_guard.sql` then sets the columns NOT NULL and drops `Assignment.policyVersion`. A fresh `npm run setup` has nothing to back-fill.
- The guard trigger: versions are inserted as DRAFT only; content and hash change only in DRAFT; status moves only DRAFT→IN_REVIEW→APPROVED/REJECTED, REJECTED→DRAFT, APPROVED→PUBLISHED→SUPERSEDED; only drafts can be deleted; a partial unique index allows one PUBLISHED version per cycle. The trigger sends `NOTIFY rules_published` itself, so every writer notifies listeners.
- REJECTED goes back to the maker: the next save moves it to DRAFT (the trigger allows REJECTED→DRAFT), so a rejected version is revised in place rather than copied.
- Separation of duties: the approver must not be the creator or appear on any `RULES_DRAFTED`, `RULES_EDITED` or `RULES_IMPORTED` audit row of the version. Rule events go on a third audit chain, `rules`.
- Documents: a kind may appear in several entries, for example `BUILDING_PLAN`, which is critical for new institutions and supporting for intake increases. The duplicate check is per application type.
- Committees gain `APPELLATE` and `HEARING`, so the modelled December 2025 addendum can move expert, appellate and hearing committees to the full council.
- Institutions gain `kind` and `isTechnical`, derived from the fictional seed names. "College of Computer Applications" is the non-technical kind.
- Holidays live in each pack's `calendar`. On publish the `Holiday` table is rewritten as the union over all current published versions, and `workdays.ts` reloads it. The seed keeps the v3 placeholder holidays (the six after the seed date).
- Filing: `forNewFiling` picks the cycle whose APPLICATION_WINDOW (with `appliesTo` true) contains today, then a LATE_FEE_WINDOW, and otherwise names the next window. Back-dated seed history passes an explicit pin to the version published on its filing date (server-side option only; never from a request).
- The rules cache uses `performance.now()` for its poll timer. That is a timer, not "today", so the clock grep test stays strict.

## Add-on A3: consumers read the rules service

- `api/src/config/index.ts` is gone. Every consumer asks the rules service. A case uses `rulesForApp`: pinned sections from its version, operational sections from its cycle's published version. A filing uses `filingContext`/`forNewFiling`. Team-level thresholds (the workload report) use `newestRules`, the newest cycle's published version.
- Assignment: `policyFor(applicationId)` gives the operational policy plus the pinned type's category weight. `Assignment.rulePackVersionId` records the published version whose policy applied, and reason texts end "Rules 2027-28 v1." instead of "Policy v1.".
- The engine refreshes the published map and publishes due scheduled versions at the start of every cycle, then reads reminder offsets, at-risk %, stalled/urgent days and escalation thresholds per case from its cycle's current version. AlertLog keys are unchanged, so sent alerts never repeat.
- Form check: the API sends the case's `formCheckRules` and resolved `norms` with every `/score` request. Python validates the expressions (only `features.*` and the norms that were sent; otherwise 422) and evaluates them with `expr.py`. Its fallback is `formcheck/app/default_rules.json`, generated from the base pack by `npm run formcheck:defaults --workspace api`. R3–R5 now compare against the norms `minDocsRatio`, `maxStudentsPerFaculty` and `minSqmPerStudent`, and the INTAKE_INCREASE EVC condition against `evcIntakeIncreasePct`. The 50 parity samples give identical hits before and after.
- Apply form: `GET /api/rules/filing` replaces the web's import of the JSON. It returns the header facts (cycle, version, effective date, window close, late fee), purview per programme, eligibility per type, route words and documents. The form gains an optional programme field (`formData.programme`).
- Purview is checked at SUBMIT when a programme is given; eligibility runs from the type's `eligibility` expression. The old "needs at least one earlier approval" message is kept when that expression is about prior approval.
- EVC scheduling stores `EvcVisit.appointedUnder` ("<appointing authority> · rules <cycle> v<n>"). DECIDE's default undertaking due date is today plus `norms.deficiencyCompliancePeriod` months (6 in the placeholder pack; the UI used 90 days before).
- Seed history: each back-dated filing gets programme codes for B.Tech, diploma, MBA and MCA courses, is pinned to the version published on its filing date, and uses that version's documents.
- `test/rules-grep.test.ts` fails if `api/src`, `api/scripts`, `web/src` or `formcheck/app` mention the three JSON files, except the seed and `api/src/rules/migrate*`.

## Add-on A4: state machine API, diff, apply scope, rebase, import/export, public endpoints

- Diff (`rules/diff.ts`): keyed arrays are matched by key (programme code, type, `kind@types` for documents, `key@level@discipline` for norms, rule id, schedule id, committee), so a reordered list is not a change. Paths look like `timelines.SCRUTINY`, `documents.FIRE_NOC@CHANGE_OF_SITE+EXTENSION+NEW_INSTITUTION.critical`, `schedule.window-main.to`. An amendment's `applyScope` keys use the same paths, and a key covers everything under it.
- Classification: relaxing changes are a window extended or opened earlier, an added application or late-fee window, a longer SLA, a document made supporting or removed, an expiry no longer needed, a norm moved in its relaxing direction (MIN lowered, MAX raised), a lower fee, and a purview, eligibility or schedule-scope condition proven to only widen. The proof evaluates the old and new condition on every seeded institution × programme and every open case of the cycle; no context may go from true to false. Added critical documents, route changes and unprovable condition changes are tightening; labels, letters, form check rules (advisory) and operational tuning are neutral.
- A case has one pin, so changes to pinned sections in one amendment must be all live or all new-cases-only; mixing them is refused at submit ("must be separate amendments"). Operational sections apply on publish whatever the scope. A version whose amendment has any LIVE path rebases on publish.
- Rebase runs after the publish commits, one transaction per case: it moves the pin, moves open WORKING items for lengthened timelines later by the difference (adds it to `pausedRemaining` for paused items), writes RULES_REBASED on the case's chain, and notifies the holder (the college when it holds the case). It is idempotent: a case already moved is skipped.
- Rollback is maker-checker too: the editor drafts `rollback-to/:olderId` (content equal to the older version, `meta.rollbackOfVersionId` set, amendment kind CORRIGENDUM), and the approver publishes it. The publish is audited as RULES_ROLLED_BACK.
- `PATCH /versions/:id` accepts RFC 6902 JSON Patch (or a whole `content`); the patched paths go on RULES_EDITED. Import accepts only files with `schemaVersion: 1`. zod drops unknown keys, the hash is recomputed (`hashMatched` reports whether it equals the file's), and the draft's parent is the cycle's published version.
- Public endpoints `/api/rules/public/notices` and `/schedule` are mounted before authentication and expose only published amendments, college-audience change notices and windows.
- Demo "Ignore schedule" is a `SimClock.ignoreSchedule` flag, set by the admin via `POST /api/demo/ignore-schedule` (audited as DEMO_IGNORE_SCHEDULE). It is honoured only when DEMO_MODE=true and applies only when no window is open.
- Impact preview (`rules/impact.ts`) is read-only and returns sentences plus lists: live moves, route, document and purview changes on the last 50 filings, form check hit counts on the 50 samples and the 60 newest seeded checks, South officer utilisation if every open task were reweighted, filing groups before and after, and refusals. About 100–300 ms on the seed.
- The demo seed has 191–192 applications: the assignment tie-break among equal-score officers compares random UUIDs, so one balancing filing can change between setups. This predates the add-on.

## Add-on A5: Rules Center, notices, impact screens

- Screens: `/rules` (cycles and versions; draft an amendment, new cycle, import), `/rules/versions/:id` (amendment card with apply scope per changed path, section nav with changed / to-fix / unsaved counts, a table or form per section, "Advanced (JSON)" tab), `/diff`, `/impact`, `/review` (approver only), public `/notices` and `/college/notices`. Editors and approvers work there; ADMIN, HoD and Bureau read it.
- Saving sends JSON Patch `replace` operations for the changed sections, so RULES_EDITED lists section paths. Invalid drafts save with their errors shown next to the rows; submit refuses them.
- The condition builder edits All/Any of "field · operator · value" rows. A value starting with `@` is a variable (`@norms.maxStudentsPerFaculty`). Conditions it cannot show as rows open in its JSON editor.
- Letter previews are filled from a few seeded cases (`GET /api/rules/letter-samples`, letter fields only), with React escaping the output.
- The college banner counts published amendments newer than the last one the user dismissed. The marker is kept per user in localStorage, so a cleared browser shows the banner again (harmless).
- The case "Rules" line links to the version for roles that can open the Rules Center; others see text. History shows RULES_REBASED as "Moved to newer rules (live amendment)".
- "Affects" on a notice lists the types named by changed documents, types or fees; general changes (norms, purview, schedule, timelines) list every type.

## Add-on A6: tests, demo step 11, README

- A version rebases open cases only when a pinned-section change is marked live (`rebasesLiveCases`). A live window extension (operational) does not move pins, so demo step 11's new-cases-only document leaves the step 1 case on v1, as the script requires. A version with a live operational change and no pinned live change publishes without moving any case.
- The college banner's "since your last visit" is a server-side `User.noticesSeenAt`. The seed sets it for every user to the later of now and the last seeded publish, so after `demo:reset` only changes published during the demo count; viewing the notices or dismissing the banner moves it forward. This replaces the localStorage marker of A5.
- `verifyChains` now checks every chain to its first broken row and reports `brokenChains` along with the first broken row. Demo step 10 tampers with one application chain, and step 11 still has to show the rules chain verifying. The admin audit log gains a Chain filter (All, Rules Center, Global).
- Demo step 11 runs after steps 1–10 without a reset; the clock is then about 86 days ahead, past the placeholder window. The window extension and the impact sentences behave the same, and the new application's header shows rules v2 with the window closed.
- A11 coverage: `test/rulepacks.test.ts`, `rules-api.test.ts`, `rules-consumers.test.ts`, `rules-a11.test.ts`, `rulepack-schema.test.ts`, `expr.test.ts`, `rules-grep.test.ts` (API), and `test_expr.py` plus the pack-rule cases in `test_formcheck.py` (form check). The "import round-trips to the same contentHash" check compares the file's hash with the hash recomputed from its content (`hashMatched`); the imported draft's own hash differs because its meta (version number, title) changes.

## Add-on B1–B4: interface

- Identity: the product is "AICTE Demo Website / एआईसीटीई डेमो वेबसाइट" with our own "AD" monogram (an SVG drawn here) and the subtitle "Approval workflow and compliance monitoring". The label "Prototype for Smart India Hackathon 2026 · Not an official AICTE system" is in the utility bar of every page, on the sign-in card and in the public footer. No official logo, emblem, flag, ministry or event mark, and no copied text. `grep -rniE "emblem|aicte-logo|ashoka|satyamev|g20" web/src web/public web/index.html` finds only prose that says these are not used.
- Tokens are CSS variables (`--c-*` in `web/src/index.css`), mapped in `tailwind.config.ts`, so `[data-theme="contrast"]` swaps the palette on any element. The style guide shows standard and contrast samples side by side this way. New tokens: `gov-ink`, `gov-ink-muted`, `gov-nav`, `gov-saffron` (non-text marks only), `gov-mark` (navy, white in contrast), `on-solid` (text on solid fills: white, black in contrast), `scrim`. Accent is #1B4F9C (hover #143D7A, soft #EAF0F8), the page is #F4F6F9, radius is 4px for controls and 6px for cards, and there are no shadows except dialogs and menus.
- Contrast (WCAG): white on gov-ink 15.4:1; gov-ink-muted on gov-ink 8.5:1; white on gov-nav 12.9:1; saffron underline against gov-nav 6.0:1 (non-text); white on accent 7.9:1; accent on page 7.3:1; accent on accent-soft 6.9:1; gov-ink on saffron (the "What's new" label) 7.2:1; high contrast #FFD54F on black 14.9:1.
- All font sizes and spacing tokens are rem, and the text-size control sets the root size (87.5 / 100 / 112.5 / 125%); A++ appears on public pages only. The work app keeps a 14/20 base; public pages use 16/24 with 28/36 titles via `.public-type`. Hindi gets 2px more line height under `html[lang="hi"]`.
- Fonts: `@fontsource/noto-sans` (latin 400/500/600/700) and `@fontsource/noto-sans-devanagari` (400–700), imported in `main.tsx` and bundled by Vite. No external font or CDN request.
- Language: `useT()` returns `en` or `hi` merged over `en`, so missing Hindi keys fall back to English and are logged once in development. Switching sets `<html lang>` and the per-route title. Hindi covers the shell, navigation, public pages (static page bodies are written in both languages), notices, sign in, Rules Center labels, role names, status badges and common buttons. Work-screen bodies and case data stay English as entered.
- Routes: `/` is the public home with the sign-in card (`/login` still works and sends a signed-in user to their work). Public pages are built from `web/src/sitemap.ts`, which the Sitemap page also renders, so the two cannot drift. "Track application" (`POST /api/public/track`) needs both the application number and the institution's permanent ID and is rate-limited. `/api/public/current` and `/api/public/clock` feed the cycle chip, footer and simulated-date chip without a login.
- The "What's new" strip is static (no scrolling, so WCAG 2.2.2 needs no pause control).
- Design review (v3 11.8 and this add-on), done on home, notices, track, the policy pages, Action Center, case view, team, college home and apply, Rules Center versions, version editor, diff, impact, review and admin:
  - records are tables, there is one primary action per view, status is text plus icon (never colour alone), the skip link comes first, focus rings are visible, landmarks are in place (header holds the utility bar, header, navigation and strip; work-app footer bar is in `<footer>`), and every control has a label;
  - axe in English, Hindi, high contrast and 125% text at 1440 and 390 px: 0 serious or critical issues and no horizontal overflow on the 13 public pages; 0 on the work screens in English, Hindi and high contrast at 112.5%;
  - the contrast theme was checked by eye: the monogram, primary buttons and links stay visible; the amber link colour skips solid accent buttons;
  - Hindi checked on the home, notices and Action Center shell; the text-size buttons work and are remembered.
- Screenshots: `npm run screens` (Playwright, 1440×900 and 390×844, English and Hindi) writes 36 PNGs to `docs/screens/`. To show impact and review it creates one draft in review if none exists; `npm run demo:reset` removes it.
- Name change (requested by the user): the product name is "AICTE Demo Website / एआईसीटीई डेमो वेबसाइट" and the monogram reads "AD". The prompt asked for a name without "AICTE"; the user chose this one. The label "Prototype for Smart India Hackathon 2026 · Not an official AICTE system" stays on every page, so the site still does not present itself as an official AICTE system. There is still no official logo, emblem or copied text.
- High contrast restyled at the user's request: no black background. It keeps the light layout of the other pages (white page, navy bars) and raises contrast with black text, darker status colours, dark navy underlined links and 2px black borders on form controls.
