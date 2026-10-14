# NECMS implementation roadmap

Milestone 1 prepares documentation only. It is complete when the five requested documents exist, baseline checks are reported honestly and implementation gates are explicit. Milestone 2 is **not implemented or authorized by completion of this document**. PatientFlow remains an operational prototype.

Documents: [baseline](NECMS_BASELINE.md), [multi-hospital design](NECMS_MULTI_HOSPITAL_DESIGN.md), [migration plan](NECMS_MIGRATION_PLAN.md), [security test plan](NECMS_SECURITY_TEST_PLAN.md).

## Milestone 1 outcome

Retain React, Django, Supabase Auth/Data API/Realtime and PostgreSQL, separate patient identity and encounters, existing board/service/resource functions, nurse coordination, DOB/reference handling, concurrency safeguards and audit records. Replace global authorization with checked hospital membership/context in the next milestone. Do not rewrite the UI or clinical workflows as part of isolation work.

Executed: 17 frontend tests, 27 Django tests, existing in-memory database checks, production build, isolated demo browser checks and limited hosted read-only Auth/anonymous-denial check all passed. Full hosted schema history and NECMS isolation/realtime tests remain unverified. No application/database changes or hosted writes were made.

## Milestone 2: exact proposed implementation steps

Proceed only after explicit approval. Each step is independently reviewable; none authorizes a production migration by itself.

| Step | Work | Verification and exit condition |
| --- | --- | --- |
| 2.1: attest baseline | Establish reviewed Git commit; collect protected read-only hosted catalog/history evidence; reconcile manual migrations/drift; confirm disposable test environment and restore procedure. | Actual deployed baseline identified; no replay assumptions; existing regression suite reproducible; restore rehearsal evidence. |
| 2.2: settle authority | Hospital owners approve facility/department model, membership/capability matrix, administrators, context lifetime, display policy and provenance process. | Explicit decisions recorded without patient data. No new access granted from legacy role names alone. |
| 2.3: add organization/access schema | New additive migrations for facilities, departments, memberships, roles/capabilities, private contexts and administrative audit. Add RLS/helper tests. | Empty installation and staged upgrade pass; unauthorized access denies; grant escalation tests pass. |
| 2.4: prepare ownership | Add nullable ownership/state fields and private manifest/quarantine support; composite keys/indexes and verified-parent invariants. Rehearse restartable backfill from an approved manifest in staging. | UUIDs/references/audit unchanged; unknown ownership remains inaccessible; cross-hospital FKs reject. No hosted backfill performed merely by deploying code. |
| 2.5: implement checked DB operations | Context issue/validation functions; scoped board/patient/resource/audit projections; scoped mutation RPCs with existing locks/versions and request idempotency; replace global policies and inventory obsolete overloads. | Direct authenticated REST/RPC negative tests pass; dual membership selected-context and revocation tests pass with real PostgreSQL concurrency. |
| 2.6: integrate Django | Authorized-hospital list/context endpoint; route/header validation, capability permissions, contextual gateway forwarding, scoped serializers and errors. Legacy routes fail closed without context. | Positive existing-role behavior preserved; forged/missing context rejects; mocked errors and real Data API tests pass. |
| 2.7: integrate React minimally | Authorized hospital selector/context state; clear/cancel previous hospital data on switch; scoped board requests and independent active/history paging. Retain existing UI components. | Browser context races, two-tab behavior, row-limit completeness, registration/edit/resource regression and stale indicators pass. |
| 2.8: secure display/realtime | Dedicated restricted display identity/projection; context-private generic Broadcast outbox or authorized polling fallback; disable raw clinical subscriptions/public channel access. | Actual network/socket privacy tests and revocation/routing tests pass. No full clinical dataset reaches shared screens. |
| 2.9: rehearse and release review | Coordinate maintenance/policy/client/server cutover in staging; ownership sign-off, full acceptance matrix and recovery drills; document exact live execution runbook separately. | All release gates satisfied; unresolved active records have approved continuity plan. Seek explicit live migration/deployment approval with concrete results. |

Do not enable a second facility in a project still protected by old global-role policies. Development migrations and acceptance fixtures belong to approved isolated environments. Production records are never used as casual test data.

## Expected files and components to change later

| Path/component | Expected Milestone 2 change |
| --- | --- |
| `supabase/migrations/` | Add new files only; ownership/schema/policies/helper/RPC/projection/audit/outbox changes. Do not edit six baseline migrations. |
| `supabase/tests/`, `scripts/check-database.mjs` | Add ownership, capabilities, context, direct-function and preservation regressions; keep mocked limitations explicit. |
| New real PostgreSQL/Supabase integration test harness | Verify direct REST/RPC, real parallel locking, Auth/Realtime and display-network behavior; development-only secrets outside repo. |
| `backend/patients/authentication.py` and new permission/context module | Preserve Auth verification; add selected-context/capability handling. |
| `backend/patients/gateway.py` | Forward context header and user's token; bind scoped projections/RPCs; never elevate ordinary requests. |
| `backend/patients/views.py`, `serializers.py`, `backend/config/urls.py` | Authorized facilities/context, scoped routes, board/display projections, ownership mismatch rejection and pagination. |
| `backend/config/settings.py`, `.env.example` | Nonsecret context/display/runtime configuration and hosted feature gates; no service key in browser configuration. |
| `backend/patients/tests.py` and related tests | Context/role regressions, forged IDs, denied writes, error sanitization and no-store behavior. |
| Migration management command | Only if attestation/adoption or nontransactional index operations require it; retain checksum/transaction safety and separately test new execution modes. |
| `src/model.ts` | Ownership/context/projection types, preserving legacy clinical vocabulary until later milestone. |
| `src/lib/api.ts`, `store.ts` | Context forwarding, scoped fetches, idempotency and independent active/history requests; keep demo distinct from live workflow. |
| `src/lib/supabase.ts`, `src/App.tsx` | Minimal selector/session-context integration, safe state reset, private generic notifications, dedicated restricted display mode. |
| `src/styles.css`, `dialog.css` | Only minimal styling required by context controls; no interface rewrite. |
| `scripts/check-browser.mjs`, frontend tests | Context-switch/request races and real server-side display assertions alongside existing demo layout checks. |
| `README.md`, architecture docs | Approved setup, context model, staged migration/deployment/recovery instructions and actual test results after implementation. |

## Subsequent clinical and operational milestones

| Milestone | Scope and retained authority | Testable exit condition |
| --- | --- | --- |
| 3: emergency arrival/lifecycle | Unknown/incomplete identity, registration progress distinct from care, explicit clinician-approved encounter closure/outcomes and movement history. Preserve identity UUIDs and existing encounter lineage. | Care entry without fabricated identity; reconciliation is audited; correct lifecycle timestamps and transitions. |
| 4: approved triage records | Hospital-approved versioned protocol definitions; structured initial/repeated assessments, assessor/time/reason and immutable history. No invented thresholds or AI triage. | Old P1–P5 preserved as legacy; approved protocol references and clinician reassessments traced without rewriting history. |
| 5: observations/escalation/handover | Time-stamped vital observations, qualified staff deterioration/escalation records, acknowledgments and accepted handovers. | Historical observations intact; accountable handover/escalation behavior matches hospital-approved workflow. |
| 6: concurrent care | Multiple independent tasks/service requests and results, explicitly separated from location and encounter care status. | Parallel tasks work without forced linear queues; space and clinical state remain independent. |
| 7: operational resilience/governance | Infrastructure-specific downtime/reconciliation, monitoring, backups, deployment security, accessibility/languages, device workflows and approved analytics. National linkage/sharing remains separate governance work. | Rehearsed downtime/restore, safe stale-state behavior, measured load and formal operational/clinical review. |

## Unresolved decisions and risk gates

Confirm actual hosted schema/history, evidence-based ownership, administrative authority, membership onboarding/revocation, hospital/department access scope, shared display audience, context lifetimes, private Realtime configuration and delivery mechanism, hosting/data-residency/retention and tested restore facilities. Hospital staff must resolve clinical protocols, training requirements, unidentified arrival policy, outcomes/closure, cleaning readiness and downtime coordination in the relevant later milestones. This roadmap does not assert Namibian legal compliance or clinical readiness.

Main migration risks: unknown manual deployment drift; identity/reference aggregation across uncertain sources; blanket ownership assignment; legacy policy/function bypasses; FK/index locking; context/realtime deployment mismatch; active patients omitted by paging/quarantine; retries producing duplicate registrations; insecure rollback. Mitigations and release gates are detailed in the linked migration and test plans.

Stop after Milestone 1. Wait for explicit approval before changing application code, creating migration files or starting Milestone 2. Any future live migration or hosted record modification needs its own concrete reviewed execution scope.
