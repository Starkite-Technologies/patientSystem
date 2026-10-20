# NECMS Milestone 3E completion report

2026-10-20 · Starkite Technologies · local synthetic verification.

**Prepared for a fictional software walkthrough and hospital requirements discussion. Not clinically validated, not a live-data pilot, and not ready for hosted deployment.** No hosted Supabase project was contacted, inspected, linked, migrated or configured. No real staff account or patient data was used. No clinical rule, triage score, escalation threshold, AI or autonomous treatment decision was introduced.

## Baseline reviewed and preserved

Reviewed the 3D completion/performance reports, demonstration guide/acceptance checklist, security register, hosted integration runbook, earlier clinical/coordination/readiness reports and relevant React, Django, SQL, permissions and test sources. Git inspection showed the existing `feature/necms-multi-hospital` branch and uncommitted 3A–3D work against tracked baseline `f625b90`. Existing `.vscode/` and milestone files were retained. No staging, commit, push, reset or deployment was performed.

The architecture remains React 19/TypeScript/Vite/Tailwind, Django/DRF, Supabase Auth and PostgreSQL/RLS. Auth user-token verification, hospital contexts, capability checks, append-only clinical/operational history, retry keys and audit transactions remain. Dependency manifests and credential files were not changed. Earlier migration files are unchanged; the new migration is additive. Patient UUIDs, encounter IDs, PF references, provisional identity and unresolved ownership quarantine remain intact.

The 3D baseline reported 44 frontend / 106 Django tests, bounded reads and 14 real local PostgreSQL concurrency/recovery checks. Those results were historical inputs, not substituted for the new executions below. Hosted Auth/REST/RLS, hospital protocols and operational approval were still unverified and remain so.

## Implemented presentation workspace

A dedicated, locally labelled NECMS presentation mode reuses the existing clinical, coordination, history, resource and staff components. It is enabled only when both presentation and synthetic-demo flags are true. Existing PatientFlow and 3D previews retain their own interfaces; no site-wide redesign or fake clinical page was introduced.

The presentation has white/light-neutral content surfaces, navy navigation, teal accents, textual status/urgency labels, focus outlines, readable tables and responsive desktop/tablet layouts. There are eight capability-controlled destinations: Emergency Overview, Patient Arrival, Awaiting Triage, Emergency Coordination, Treatment Spaces, Clinical Timeline, Operational Review and Hospital Administration. Each opens an existing operational function; no grant is inferred from a job title. The overview and coordination destinations share the same checked board, avoiding a second clinical decision model.

Patient Arrival opens minimum intake directly. Clinical views use bounded encounter search/history; completed encounters can be selected in the read-only timeline. The care-status control has an explicit accessible name. Operational Review links back to an encounter's evidence and acknowledgement controls. The staff panel retains its protected lifecycle. Navigation is tested against primary and companion capabilities; an administrator-only context receives no implicit clinical pages.

Server-authorised full-scope summaries now explicitly include reviewed provisional patients, patients waiting for services, services underway and exceptions awaiting acknowledgement. Service-work state and encounter care status remain separate, with separate labels/counts. Exception counts are NULL without exception-review authority. Counts are independent of search/page filters and department scope is explicit. Unknown urgency is not assigned a low rank. No clinical threshold for “high priority” was added.

The existing default-25/maximum-50 bounded collection API, search, filters, cursor consistency detection and independent history/evidence pagination remain. Current-page queue polling, freshness labels, denial clearing and protected response gates are preserved. The presentation additionally polls bounded clinical selection pages where needed; it does not download the whole hospital. The arrival-only form uses the existing authorised department-options catalogue, not clinical record lists. Raw clinical realtime remains disabled.

## Client's prioritisation scenario and shift

Reset creates three predetermined fictional cases. A (`SYN-DEMO-0001`) arrives first with a fictional clinician-entered/reviewed P4, B (`SYN-DEMO-0002`) arrives later with an illustrative reviewed P1 for the same service, and C (`SYN-DEMO-0003`) has unknown urgency/provisional identity. Their timestamps are relative to reset. A/B have separate preloaded synthetic assessment/review records explicitly labelled as fixture inputs, not historical clinical evidence.

The board presents C in the unknown lane, then B before A within the reviewed lane. Arrival time, elapsed waiting, provisional source/review, responsible fictional staff, service and work state are visible. Explicit call, acceptance and reasoned reassignment are demonstrated. Starting A first is permitted and captures the contemporaneous B/C queue evidence; staff can append an explanation/acknowledgement without altering the original. A visible notice explains that patient needs/resources can justify a different treatment sequence and that the system does not judge clinical appropriateness or block urgent care.

The repeatable A–J script covers arrival visibility; known/unidentified rapid intake; measured observations and manual provisional assessment; independent review; parallel service work; clinician responsibility/call/accept/reassign/start; treatment-space conflict; immutable sequencing evidence; manual reassessment acknowledgement; discharge/transfer with space release and retained history. Completing an encounter does not silently complete outstanding work. New arrivals without work items remain visible. Unknown values stay unknown until explicit staff documentation; observations never compute urgency.

The dedicated mock browser toolbar supports facilitator/reception/nurse/doctor/coordinator/administrator examples, a separate assessor/reviewer switch and reset. Role switching invalidates mock contexts and reloads. Reset discards in-memory changes, restores the three fixtures/two illustrative assessments, invalidates cursors/contexts and releases pending fixture requests. No Django/SQL reset endpoint or database client is involved. All external traffic is blocked. These are **simulated users and services, not real Auth accounts or proof of professional credentials**.

## Security review, repairs and permission boundaries

| Area | Finding and action | Evidence / remaining boundary |
| --- | --- | --- |
| Legacy privileged configuration keys | Confirmed that only modern `sb_secret_` was rejected. Added frontend/Django screening rejecting legacy JWT roles other than anonymous and malformed JWT-like values. | Four frontend and four Python tests passed. Screening is not JWT signature authentication, key-validity verification or sanitisation of Vite output. Existing misconfigured build artifacts must not be considered safe because runtime initialization is rejected. No credential leak was observed or disclosed. |
| Arrival-only account bootstrap | Workspace previously required clinical companion permissions even for minimum-intake staff. Added a context-metadata-only response for contexts without encounter-read permission, containing no clinical records or clinical RPC calls. | Two Django regressions cover intake-only empty data and missing identity companion denial. Existing authenticated context/hospital/purpose checks still run. No role grants were added; full reception-minimal identity lookup is not implemented. |
| Audit snapshot REST access | Investigation found existing column-level SELECT grants already exclude before/after snapshots. This was not a confirmed disclosure. | New actual SQL probes reject both columns and SELECT *, verify curated audit output and capability-dependent exception counts. Hosted grants/default privileges could differ; actual REST remains untested. |
| Legacy unbounded endpoints/projections | Hospital checks remain but older board/coordination/history/staff compatibility interfaces can return bulk results and remain directly callable where granted. | Open scale/deployment risk; new bounded screens do not disable old RPCs. Target-specific review, deprecation/rate/retention/query budgets and direct REST tests remain. No silent truncation or unbounded fallback was introduced. |
| Staff administrative access | Existing same-hospital role check, membership permission, no self-management, held-capability delegation ceiling and atomic audit remain. Admin-only presentation has no clinical privilege. | Existing SQL/Django/browser regressions rerun. Admin catalogue/provisioning, staff pagination and professional governance remain incomplete. Mock staff mutation is a walkthrough fixture, not real provisioning. |
| Identity, departments and display | Explicit hospital-scoped identity selection and separate restricted server display retained; department filters remain filters. | No merge, department-only authorisation or broad reception clinical access was added. Restricted display has four fields; actual wall devices and managed Auth still need approval/testing. |
| Cache, expiry, revocation and switching | Shared protected request epochs, no-store middleware, polling/denial clearing and immediate local logout retained. New presentation uses those gates. | Browser delayed-result logout/hospital/role tests and actual local SQL membership revocation passed. Hosted session refresh/expiry, proxy/cache, device privacy and outage policy remain unverified. |

The updated security register records these dispositions. Clinical and capability checks were not relaxed. The proposed hospital role matrix is documented separately from synthetic grants; the administrator cannot delegate clinical powers not held. `protocol.approve` remains reserved and no approval/activation workflow is invented. No historical record was assigned hospital ownership.

## Migration and recovery status

New thirteenth migration: `supabase/migrations/202610200001_necms_presentation_summaries.sql`. It replaces the existing checked `necms_read_page` function with four extra operational-summary fields. Signature, validated filters/cursors, fixed search path, explicit membership/capability checks, grants and RLS are preserved. It adds no table, role capability, protocol, clinical field backfill or ownership mapping. The existing 35 persistent tables are unchanged.

**Executed only in disposable PGlite and fresh synthetic databases on the verified temporary loopback PostgreSQL 17.11 cluster.** Local setup never reads hosted connection strings; the Python runner validates the fixed local data directory/listen address and strips ambient libpq overrides. Nothing was applied to any hosted PatientFlow/Supabase database.

Embedded rehearsal verifies every row in all 35 tables across application and rollback, restores the exact previous read-function definition after transactional rollback, then applies the forward migration and runs the privacy/summary probes. Independent PostgreSQL verification applies all thirteen migrations and executes the new fixtures plus prior isolation/clinical/coordination/bounded fixtures. Actual custom-format dump and fresh-database restore match 35 table contents and function definitions/ACLs/RLS flags/policies. This is not a Supabase provider backup, operational RPO/RTO or approved hosted migration rehearsal. Hosted execution still requires specific target/schema/provenance/recovery approval.

## Files created and changed in 3E

Created application/tests:

- `src/ClientPresentation.tsx`, `src/presentation.css`, `src/lib/presentation.ts`, `src/lib/presentation.test.ts`.
- `src/lib/keySafety.ts`, `src/lib/keySafety.test.ts`, `backend/patients/key_safety.py`, `backend/patients/test_key_safety.py`.
- `supabase/migrations/202610200001_necms_presentation_summaries.sql`, `supabase/tests/presentation_security.sql`.
- `scripts/start-client-demo.mjs`, `scripts/demo-client-necms.mjs`, `scripts/client-demo-toolbar.mjs`, `scripts/check-client-demo.mjs`, `scripts/check-presentation-database.mjs`.

Extended preserved working files:

- `src/App.tsx`: lazy gated presentation entry; normal screens retained.
- `src/ClinicalWorkspace.tsx`: arrival/timeline presentation modes, completed-history selection, explicit care-status accessible name.
- `src/PagedCoordinationBoard.tsx`: initial scoped encounter filter, extra full-scope metrics and readable urgency badges; existing actions retained.
- `src/lib/supabase.ts`, `backend/config/settings.py`: public-key screening.
- `backend/patients/paged_views.py`, `backend/patients/test_paging.py`: clinical-free context bootstrap and regression cases.
- `scripts/start-paged-test.mjs`: explicit allowlisted presentation preview port; existing 5176 behaviour retained.
- `scripts/synthetic-paged-fixture.mjs`: optional three-patient scenario, context/role permission simulation, independent fixture assessments, dynamic evidence, unworked arrivals, closure/history and safer reset; original 80-case fixture retained for 3D tests.
- `scripts/run-isolated-checks.ps1`: 3E SQL suite; `scripts/check-postgres-concurrency.py`: new privacy fixture on the disposable real server.
- `docs/architecture/NECMS_SECURITY_AND_READINESS_REGISTER.md` and `NECMS_HOSTED_INTEGRATION_RUNBOOK.md`: dated findings and new migration inventory.

Created required deliverables:

- This report.
- [Hospital client demo script](../business/NECMS_HOSPITAL_CLIENT_DEMO_SCRIPT.md).
- [Pilot proposal and proposed permission matrix](../business/NECMS_HOSPITAL_PILOT_PROPOSAL.md).
- [Hospital requirements checklist](../business/NECMS_HOSPITAL_REQUIREMENTS_CHECKLIST.md).
- [Clinical governance checklist](NECMS_CLINICAL_GOVERNANCE_CHECKLIST.md).

Business documents describe proposed discovery, a conditional one-ED pilot, stakeholders, infrastructure, training, data protection, success-measure definitions and support/change control. Commercial amounts are `[NAD amount TBD]` placeholders with quotation inputs. No fee, hospital budget, customer commitment, outcome, service level or agreement was fabricated. All hospital approval fields remain unsigned.

## Actual tests and results

All tests use synthetic data, isolated engines or blocked-external-traffic browser fixtures. Final executed checks have no unresolved failure or expected-failure suppression.

| Check | Actual result / scope |
| --- | --- |
| Frontend Vitest | **52 passed**, eight files; includes four key-screening and four permission-navigation tests |
| Django patients | **112 passed**, system check clean; four new key tests and two new workspace cases; upstream Auth/Data API mocked |
| TypeScript/Vite build | Passed; main JS **499.50 kB**, separate presentation/clinical/coordination chunks; no chunk-size warning; not deployed |
| Original SQL/hospital suites | Passed reference/identity/DOB, RLS/isolation, versions, retries, audit-failure rollback and resource conflicts |
| Clinical SQL | **32 assertions / 25 negative probes passed** |
| Coordination SQL | **30 assertions / 22 negative probes passed** |
| Readiness/bounded SQL | Existing preservation/rollback/index checks passed; bounded suite **17 assertions / 28 negative probes passed** |
| New 3E SQL | **6 assertions / 4 negative probes passed**, plus 35-table preservation, previous-function DDL rollback and forward checks; no auto grants |
| Existing hospital review | **5 checks passed**, including raw clinical publication removal, RLS, function execution and audit integrity |
| Real PostgreSQL concurrent/recovery suite | **14 checks passed** with actual independent connections, including page/read change reconciliation and fresh-database restoration; Auth identity stubbed |
| Existing browsers | Legacy PatientFlow, clinical, coordination, readiness, bounded/paged and 3D synthetic-demo scripts passed |
| Hospital browser | Passed with all five actual flags: `NECMS_REVIEW_MULTIPLE_SWITCH`, `NECMS_REVIEW_LOGOUT`, `NECMS_REVIEW_SLOW_DENIAL`, `NECMS_REVIEW_CONNECTION`, `NECMS_REVIEW_DISPLAY_RACE` |
| New client shift browser | **15 named checks passed**: three-patient order/unknown/read-only; call/accept/reassign/start; queue evidence/addendum; known/unknown arrival; unworked arrival visibility; observation/independent review; space conflict; parallel reassessment acknowledgement; discharge/history; tablet; hospital switch; role/staff denial; repeatable reset; restricted display; delayed-success logout |

Browser tests run actual React/headless Edge, with Auth/Django responses intercepted. Real local PostgreSQL exercises roles/RLS/functions/transactions, but not actual Supabase JWT/REST transport. These two evidence types are not combined into a claim of full deployed integration. Concurrent held-capability deletion, every lock graph, sustained HTTP load and managed service recovery are not exhaustively tested. Existing 3D performance figures remain historical; no new capacity certification is claimed for 3E.

Final Git whitespace checks passed with ordinary LF/CRLF conversion notices; the staging area is empty. Environment files, local access tokens and generated synthetic artifacts remain ignored. Targeted new-source/document credential-pattern and UTF-8 checks passed; this is not a complete historical secret audit. All four owned previews and the temporary PostgreSQL server were stopped. Windows TCP-listener inspection confirmed no listeners on 5174, 5175, 5176, 5177 or 55439; an earlier sandbox socket probe was inconclusive and was not accepted as shutdown evidence. Temporary synthetic recovery artifacts remain outside Git.

Initial development failures were corrected rather than hidden: a mock staff-admin matcher collided with the paginated staff directory; a newly created mock reassessment inherited acknowledgement from a different task; the browser expected a nonexistent observation label; and the care-status selector needed a stable explicit accessible name. Predetermined reviewed fixtures now have explicit illustrative assessment/review records. Final checks retain the same underlying permission, unknown-visibility, evidence, acknowledgement and history assertions. Expected malformed-request warnings are negative-test outputs, not test failures.

Desktop overview, operational-review and tablet screenshots were captured and visually inspected under ignored `test-results/necms-3e-01-overview.png`, `necms-3e-02-review.png` and `necms-3e-03-tablet.png`. The interface is readable in the tested layouts and uses text rather than colour alone. The workflow remains vertically substantial and tables scroll horizontally on tablet; facilitator rehearsal and real hardware/assistive-technology testing are still required. Screenshots are not accessibility or clinical usability certification.

## Reproduction and limits

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-isolated-checks.ps1
node scripts/check-presentation-database.mjs

# Terminal 1: dedicated fictional presentation preview
node scripts/start-client-demo.mjs
# Terminal 2: interactive walkthrough OR headless scenario check
node scripts/demo-client-necms.mjs
node scripts/check-client-demo.mjs
```

The interactive command is provided for the user; verification used headless Edge, not a claim that a hospital facilitator rehearsed it. Never substitute hosted credentials or an ordinary live-connected browser. The real PostgreSQL runner additionally requires the verified disposable cluster described in the existing runbook and explicit `--confirm-local-synthetic`; it is not a command for a managed database.

## Open blockers, approvals and next milestone

1. **Hosted integration:** still prohibited/unverified. Need a separately approved dedicated synthetic-only project, exact identity/endpoint, deployed schema/migration compatibility, least-privilege real test users, data classification, restored recovery and approval for each specific execution. Existing credentials are not proof. No real Auth/session expiry/revocation, REST/RPC/default grants, proxy/cache or provider configuration was tested.
2. **Clinical governance:** protocol/version, professional authority, assessment review/amendment/correction, service readiness, treatment-sequence review, reassessment/escalation ownership, unknown identity, handover, privacy/retention and downtime/safety acceptance remain unsigned. No clinical protocol can be activated by this demonstration.
3. **Technical risks:** legacy bulk RPC/staff paths, O(scope) revision/count scans, offset sorting, frequent restarts under change, retention/rate controls, reception-minimal identity data, department-only access, formal handover/merge/correction/roster retirement and device/session management remain. No durable offline clinical-write reconciliation exists.
4. **Demonstration acceptance:** technical synthetic scenarios passed; client acceptance, facilitator rehearsal, actual devices/accessibility, audience/privacy/recording policy and interpretation of urgency labels require agreement. No waiting-time reduction or clinical outcome is claimed.
5. **Commercial pilot:** the proposal is discussion material. Discovery scope, quote inputs, support responsibilities, hosting/security/privacy and hospital clinical sign-off are prerequisites to a separately authorised live-data pilot.

Recommended next stage: a scoped demonstration/discovery review with named hospital stakeholders, followed by legacy-access/scale gap resolution and actual isolated Supabase integration/recovery verification under separate approval. Do not compensate for missing approvals by adding clinical automation. Stop after 3E and obtain explicit authorisation for the next implementation scope.

## INFORMATION FOR CHATGPT — NEXT DEVELOPMENT STAGE

- Preserve the existing stack and uncommitted 3A–3E sources, history, UUID/reference formats, 2D request protection and all unsigned governance boundaries. No commit/push/deployment or hosted connection occurred.
- Presentation mode lives in `ClientPresentation.tsx` and the dedicated 5177 mock harness. It reuses genuine existing workflow components; its identities/services/role changes/reset are simulated. Facilitator grants are not approved operational role assignments.
- New migration is `202610200001_necms_presentation_summaries.sql`, additive summary fields only, no role grants/data rewrite. It ran only on disposable local engines. Actual local recovery matched 35 tables plus function/ACL/RLS/policy evidence; managed recovery remains unverified.
- Verified local results: 52 frontend / 112 Django tests, successful build, 3E SQL 6 assertions/4 negative probes, prior SQL/browser suites, 15 client-shift checks and 14 real PostgreSQL concurrency/recovery checks. Auth/REST mocks or identity stubs remain explicit; do not call this hosted integration or clinical validation.
- Security repairs: reject privileged/malformed legacy configuration JWTs, retain proper user-token Auth verification, and permit a clinical-free context shell for intake-only accounts without broad grants. Audit snapshots were already column-restricted; local probes now prove that boundary. Vite artifact/hosted grant review is still required.
- Keep urgency, care status, service work and location independent. Three-patient example is predetermined fiction; unknown remains unknown, care start is explicit and never blocked by missing sequencing explanation. Original queue evidence and appended explanations survive closure.
- Use the client script, proposal/role matrix, requirements and clinical-governance checklists for a potential hospital discussion. No agreed fee, customer commitment, live-data pilot or hospital approval exists.
- Next work must agree exact scope: stakeholder discovery, remaining legacy/scale/privacy gaps, approved synthetic Supabase target with recovery and real Auth/REST/RLS tests, plus clinical/device/privacy acceptance. No permission to migrate hosted data, deploy, grant roles or activate protocols is implied.
