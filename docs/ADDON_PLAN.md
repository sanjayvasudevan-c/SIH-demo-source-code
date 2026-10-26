# Add-on plan: yearly rule packs and an AICTE-style interface

This maps `AICTE_RulePacks_UI_Addon_Prompt.md` onto the repository as it stands after phases 0–4. Adaptations are also recorded in `DECISIONS.md`.

## 1. What already exists

| Area | State |
|---|---|
| Phases | 0–4 of the v3 build are done (foundation, workflow and assignment, deadline engine and scheduler, Action Center and dashboards, post-approval and form check). 63 API tests (Vitest) and 13 form check tests (pytest) pass; the Section 14 demo script runs end to end. |
| Rule loaders | `api/src/config/index.ts` loads and zod-validates three files at import time: `shared/rules.json` (types, routes, documents, SLAs, reminders, thresholds), `shared/assignment-policy.json` (weights, capacities, eligibility), `shared/formcheck-rules.json` (R1–R5). They are imported as module constants (`rules`, `policy`, `formcheckRules`) by 15 API files. The web apply form imports `shared/rules.json` directly (`web/src/lib/rules.ts`). The Python service reads `shared/rules.json` (critical documents) and `shared/formcheck-rules.json`. |
| Role enum | `COLLEGE, OFFICER, SENIOR, SUPER_SENIOR, HOD, BUREAU, COMMITTEE, AUTHORITY, ADMIN`. |
| Screens | Login; college home, apply, case, compliance; officer Action Center and My tasks; case view; EVC, committee, authority and Bureau queues; availability; team; workforce; admin (time travel, reset, audit, directory, scheduler); style guide. |
| Audit | Per-application hash chains plus a `global` chain (`lib/audit.ts`), append-only trigger and revoked grants. |
| Seed | Directory plus about 190 applications built by the real actions under a backdated clock; template database for `demo:reset`. |

## 2. How each item maps onto the code

| Add-on item | Where it goes |
|---|---|
| A2 schema | `api/src/rules/schema.ts` (zod, with a cross-field `superRefine`), JSON Schema exported to `shared/rulepack.schema.json` by `api/scripts/export-rulepack-schema.ts`. |
| A3 expressions | `api/src/rules/expr.ts` and `formcheck/app/expr.py` (same JSON-logic subset, written twice), `shared/expr-vars.json`, `shared/expr-conformance.json` run by both test suites. |
| A3 form check | `/score` receives the case's resolved `formCheckRules` and `norms`; Python evaluates them with `expr.py`, falling back to its built-in copy (`formcheck/app/default_rules.json`). The Node fallback evaluates the same rules with `expr.ts`. |
| A4 apply scope | `api/src/rules/diff.ts` (structural diff and relaxing / tightening / neutral classification) and `api/src/rules/rebase.ts` (live rebase on publish). |
| A5 data model | New Prisma migration: `ApprovalCycle`, `RulePackVersion`, `Amendment`; `Application.cycleId` and `rulePackVersionId`; `Assignment.rulePackVersionId` replacing `policyVersion`; `EvcVisit.appointedUnder`; roles `RULE_EDITOR`, `RULE_APPROVER`; `prisma/sql/002_rulepack_guard.sql` (immutability trigger, transition list, one PUBLISHED per cycle). |
| A6 runtime | `api/src/rules/service.ts` (cache keyed by version id, current-published map refreshed by `LISTEN rules_published` and a 30 s poll) and `api/src/rules/resolved.ts` (helpers over a resolved pack). Every module that imported `config/index.ts` is rewired; `config/index.ts` is removed from runtime. |
| A7 API | `api/src/routes/rules.ts` under `/api/rules`, plus public `/api/rules/public/*`. State machine in `api/src/rules/versions.ts`. |
| A8 impact | `api/src/rules/impact.ts` (read-only). |
| A9 screens | `web/src/pages/rules/*` (cycles and versions, section editors, diff, impact, review), `web/src/pages/public/Notices.tsx`, apply form header, case "Rules" line. |
| A10 migration and seed | `api/src/rules/migrate-from-json.ts` builds `2026-27 v1` from `shared/seed/*.json` (the three JSON files move there) and back-fills; `prisma/seed/rulepacks.ts` adds v2 (addendum, modelled on 04 Dec 2025), v3 (revised public notice, modelled on 04 Feb 2026) and `2027-28 v1`; history filings pin to the version published on their filing date. |
| B1–B4 | `web/tailwind.config.ts` tokens, self-hosted `@fontsource` fonts, public shell and work shell components, `web/src/strings/hi.ts`, static GIGW pages, `npm run screens` (Playwright) writing `docs/screens/`. |

## 3. Differences from the v3 spec and from this prompt's assumptions

- **Product name.** The prompt calls the prototype "AICTE Demo Website"; the v3 build used "AICTE Approvals" as its working title. Part B renames the interface to AICTE Demo Website / एआईसीटीई डेमो वेबसाइट with the "Not an official AICTE system" label, and drops "AICTE" from the product name.
- **Programmes.** v3 applications carry courses but no programme. Purview, schedule scoping and norms by level need one, so the apply form gains a programme field (`formData.programme`, a code from the pack's `programmes`), and institutions gain `kind` and `isTechnical` facts.
- **Steps.** The prompt's commits are A1–A6 then B1–B4, while its sections run A1–A12. The work is grouped into six A commits as listed in the task list (A1 schema and expressions; A2 data model and service; A3 consumers and seed; A4 state machine, diff, rebase and API; A5 impact and screens; A6 tests, demo step 11 and docs) and four B commits.
- **Python reads.** The Python service also read `shared/rules.json` and `shared/formcheck-rules.json` at runtime; both reads go (rules arrive in the request; a built-in copy is the fallback).
- **Fresh setup is the supported upgrade path.** `npm run setup` recreates the database; `migrate-from-json.ts` also back-fills an existing database for completeness.

## 4. Status

| Step | Commit | State |
|---|---|---|
| A1 schema and expressions | `addon A1` | done |
| A2 data model, guard, roles, migration, service | `addon A2` | done |
| A3 consumers, Python rules, apply form filing context | `addon A3` | done |
| A4 API, diff, apply scope, rebase, import/export, public endpoints | `addon A4` | done |
| A5 Rules Center, impact, notices | `addon A5` | done |
| A6 A11 tests, demo step 11, README sections | `addon A6` | done |
| B1–B4 interface | `addon B1-B4` | done |
