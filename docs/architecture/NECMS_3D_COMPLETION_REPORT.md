# NECMS Milestone 3D completion report

2026-10-19. Local synthetic development and verification only. **Operational prototype; not clinically validated or ready for hosted deployment.** No hosted project was connected, inspected, migrated, seeded or deployed. No real patient information, clinical scoring criteria, automatic treatment decisions or escalation thresholds were introduced.

## Outcome and preserved baseline

Implemented bounded emergency coordination reads, explicit hospital-scoped patient search, paginated clinical/operational histories and a fictional demonstration harness. Existing care mutations, immutable evidence, independent assessment review, identity/reference formats, capability enforcement and the restricted display projection remain. Unknown urgency remains visible without being assigned a low clinical rank. Summary counts describe the complete hospital/department scope, including patients outside the current page or search results.

The working tree already contained uncommitted 3A, 3B and 3C implementation. These changes and the user's `.vscode/` files were preserved. Branch remains `feature/necms-multi-hospital`, tracked baseline `f625b90`. No staging, commit, push or cleanup was performed. The diff against HEAD includes earlier milestones; the file inventory below identifies this milestone's contribution. React, Django, Supabase and PostgreSQL remain the application architecture; dependency manifests and credentials were not changed.

## Files created or extended

New implementation and verification files:

- `supabase/migrations/202610190001_necms_bounded_reads.sql` and `supabase/tests/bounded_reads.sql`.
- `backend/patients/paged_views.py` and `backend/patients/test_paging.py`.
- `src/PagedCoordinationBoard.tsx`, `src/PatientPicker.tsx` and `src/lib/paging.tsx`.
- `scripts/check-bounded-database.mjs`, `scripts/benchmark-bounded-postgres.py`, `scripts/check-paged-browser.mjs` and `scripts/check-synthetic-demo.mjs`.
- `scripts/synthetic-paged-fixture.mjs`, `scripts/start-paged-test.mjs` and `scripts/demo-necms.mjs`.

Extended existing sources:

- `backend/config/urls.py`: bounded collection and workspace routes. `backend/patients/necms_views.py`: companion capability validation within the existing checked hospital context.
- `src/App.tsx`, `src/lib/store.ts` and `src/model.ts`: default bounded workspace/coordination reads, page controls, server search, archive/resource/activity views and page-aware labels.
- `src/ClinicalWorkspace.tsx`: bounded histories and department/space selection; latest assessment remains available before assessment entry for staff with history-read permission.
- `src/CoordinationBoard.tsx`: reuse existing mutation controls with independently paged service/staff/team/reason selection. `src/clinical.css`: bounded table viewport, sticky headings, filters and responsive counts.
- `scripts/start-necms-test.mjs`: explicit compatibility mode for historical browser contracts. `scripts/run-isolated-checks.ps1`: includes bounded SQL verification. `scripts/check-postgres-concurrency.py`: executes the new migration/fixtures and adds committed-change cursor reconciliation.

Documentation created: this report, `NECMS_3D_PAGINATION_DESIGN.md`, `NECMS_3D_PERFORMANCE_REPORT.md`, `NECMS_DEMO_GUIDE.md` and `NECMS_DEMO_ACCEPTANCE_CHECKLIST.md`. The security/readiness register receives a dated 3D addendum. Ignored `test-results/` contains reproducible local measurement artifacts; temporary PostgreSQL binaries, synthetic databases and recovery dumps remain outside Git.

## Database and API contract

The twelfth, additive migration creates private `necms_private.read_cursors`, a checked `necms_read_page` RPC, a non-public revision helper and five public lookup indexes plus cursor-expiry indexing. No historical records are backfilled, re-owned, renumbered or deleted. Existing migrations remain unchanged. **Execution was limited to disposable PGlite databases and the verified temporary loopback PostgreSQL 17.11 server. No hosted execution is approved or claimed.**

`GET /api/necms/hospitals/<hospital_id>/read/<kind>/` serves 17 bounded collections: queue, patients, encounters, assessments, vitals, timeline, work events, evidence, exceptions, annotations, audit summaries, staff, teams, services, reasons, departments and resources. `GET .../workspace/` provides a bounded legacy-screen bundle instead of retrieving all patients and histories. Default page size is 25; maximum is 50. Evidence arrays and annotations are separately paged rather than nested without bounds. Operational reviews also have a hospital-wide paginated list so they remain discoverable outside the current encounter page.

Opaque two-minute cursor UUIDs bind user, authorised context, hospital, collection, filter hash, revision, page size and offset. Stable ordering ends with record identifiers. Foreign-context tokens fail; changed filters, size, expiry or hospital revision require restarting from the first page. Before/after revision checks detect concurrent committed changes without locking clinical rows. This is explicit conservative reconciliation, not a frozen snapshot or constant-cost change feed. Reads may write private continuation metadata; they do not mutate clinical records.

Supabase Auth and user-token access remain. Django validates active context, purpose, hospital and primary/companion capabilities; privileged SQL independently repeats membership, capability and relationship checks. A browser hospital identifier grants nothing. Exceptions/annotations require exception-review plus queue, encounter and patient-identity read permissions in both layers. RLS stays enabled; revision helpers and private cursor rows are inaccessible to ordinary callers. No service-role gateway or unauthorised fallback was added.

Department filters narrow hospital access; department-only authorisation is not implemented. Search uses validated parameters rather than client SQL. Unknown/unsupported filters fail instead of silently broadening a query. Restricted display contexts cannot fetch clinical pages and retain the separate four-field server projection.

## Interface and polling

The default coordination board requests one current page, offers explicit search and department/service/state/triage/provisional-urgency/team/person filters, and distinguishes unknown from provisionally reviewed urgency. Work state, clinical urgency, care status and treatment space remain separate. Several work items can belong to an encounter. Counts cover the full hospital/department, while row/page labels explain that other patients exist outside the displayed subset. Explicit filters make unknown and reviewed urgency records discoverable; the software does not select a patient for care.

Clinical histories, queue evidence, annotations and patient/categorical selections load on demand with continuation controls. Histories are not downloaded on each queue poll. A selected row remains read-only until an explicit action. Patient lookup preserves ambiguity and requires a deliberate choice; provisional identities cannot be silently treated as reconciled registrations.

Five-second protected polling coalesces outstanding reads. Transport failures retain clearly marked last-confirmed data; a confirmation older than 15 seconds is labelled stale even when a request hangs. This is a technical freshness label, not a clinical reassessment deadline. Selection/filter changes hide old data immediately. Hospital switch, denial, capability changes and logout invalidate pending results; a late success cannot restore the previous hospital. A stale cursor clears obsolete pages and announces the first-page restart. Raw clinical realtime remains disabled.

Existing unbounded read routes remain for compatibility, with `VITE_NECMS_PAGED_READS=false` used explicitly by the historical test preview. New read failures never trigger automatic unbounded fallback. Legacy staff administration still uses its existing bulk interface; the older visit dialog initially receives at most 50 resources. The dedicated resource view and clinical care selectors are independently paged. These residual paths need review before operational use; bounded new screens do not establish that every old endpoint is bounded.

## Actual verification results

| Check | Executed result and boundary |
| --- | --- |
| Frontend Vitest | 44 passed across six files |
| Django patient suite | 106 passed, system check clean; Auth/Data API upstreams mocked |
| TypeScript/Vite build | Passed; main JS 499.06 kB, separate clinical/coordination/patient-picker chunks, no chunk warning |
| Baseline and hospital SQL | Passed identity/reference/DOB, RLS, isolation, retries, versions, audit failure and resource-conflict checks |
| Clinical SQL | 32 assertions and 25 negative probes passed |
| Coordination SQL | 30 assertions and 22 negative probes passed |
| 3C readiness SQL | Passed populated preservation, rollback, index and existing coordination checks |
| New bounded SQL | 17 assertions and 28 negative probes passed, including missing companion permissions; pre-existing 34-table contents preserved and transactional DDL rollback verified |
| Existing hospital review | Five preservation/publication/RLS/function/audit review checks passed |
| Real independent PostgreSQL connections | 14 checks passed; actual roles/RLS/functions/locks/transactions, Auth identity stubbed |
| Existing browser suites | Legacy demo, clinical, coordination, readiness and hospital suites passed; all five hospital race-review modes enabled |
| New browser suites | Bounded board/search/history/freshness/access races and synthetic demonstration scenarios executed with real React/headless Edge and intercepted upstreams |

The real PostgreSQL suite verifies competing space assignments, encounter versions, competing and separate work transitions, narrow snapshot locks, duplicate arrival/event requests, membership revocation during a waiting write, concurrent A/B isolation, audit failure rollback, lock timeout, server deadlock detection and fresh-database recovery. The new case reads a page while a clinical writer holds a row lock, then rejects the old continuation after that writer commits. Recovery compares all 35 persistent public/Auth/private tables by contents and verifies function definitions/ACLs, RLS flags and policies. This is local synthetic recovery, not managed Supabase restoration or an operational RPO/RTO.

Final Git whitespace checks passed with ordinary LF/CRLF conversion notices; no files are staged. Environment files, local tokens and generated results remain ignored. Targeted new-source credential-pattern and UTF-8 checks passed; this is not a complete historical secret audit. The three owned browser previews and temporary PostgreSQL server were stopped; ports 5174, 5175, 5176 and 55439 were confirmed closed. Synthetic recovery artifacts remain outside the repository.

Tests are not presented as first-attempt passes: a new fixture initially lacked a membership intentionally revoked by an earlier test; explicit fixture restoration corrected the setup. Adding the hospital-wide review list made a browser text locator match two legitimate copies; it was scoped to the selected-encounter copy without removing the assertion. A revocation probe also raced with another protected read that correctly cleared the refresh button; the final probe observes revocation through regular polling and still asserts denial and clinical-data clearing. An earlier build request was rejected by automatic approval review as out of credits and did not execute; after the user's continuation, the authorised retry executed successfully. Expected malformed-request warnings are negative-test evidence, not suppressed failures. No hosted Auth, real bearer-token REST/RPC, managed session expiry or production configuration was verified.

## Performance and demonstration evidence

The [performance report](NECMS_3D_PERFORMANCE_REPORT.md) records actual synthetic PostgreSQL measurements at 100, 1,000, 5,000 and 10,000 active encounters, SQL plans, payload sizes, filtering/search, four independent readers and in-process Django requests. At 5,000 encounters the retained legacy bundle was 7,947,870 JSON bytes versus 23,180 for a 25-row queue page; measured SQL was approximately 557 ms versus 358 ms. At 10,000, the page remained approximately 23 KB but its measured SQL was approximately 576 ms. These are laptop observations, not hospital capacity guarantees. Full-scope counts/revision scans still scale with hospital size, and busy-hospital revisions can force frequent first-page restarts. Sustained load, managed network and real device behaviour remain unverified.

The [demo guide](NECMS_DEMO_GUIDE.md) covers scenarios A–H: known/unknown arrivals, manual assessment and independent review, parallel services and responsibility, space contention, sequencing evidence, hospital isolation/revocation/display privacy and recovery/reset. Its Playwright harness intercepts Auth/API calls and blocks other external traffic; reset clears only in-memory fictional arrays. There is no application/SQL reset endpoint and no route from this reset to a hosted database. Mock actor switching is explicitly labelled and is not real authentication. Separate SQL tests exercise actual database authority. The [acceptance checklist](NECMS_DEMO_ACCEPTANCE_CHECKLIST.md) distinguishes observed local controls from outstanding hospital/facilitator approvals.

## Remaining gates and recommendation

1. Hosted integration remains blocked pending exact dedicated synthetic-only project identity, ownership approval, deployed catalogue/migration compatibility, least-privilege user-token accounts, recovery demonstration and specific migration-execution approval. Existing credentials alone satisfy none of these gates.
2. Bounded responses solve the new screen's large payload, not all scan/sort costs. Evaluate revision/count design, retention/rate limits, high-change paging, sustained concurrent APIs and legacy bulk paths. Review direct REST column privileges for older audit/projection interfaces; curated new endpoints alone do not close every legacy access path.
3. Hospital decisions remain required for approved protocol/version, professional scope, capability matrix, identity reconciliation, service readiness, reassessment/escalation ownership, correction/addenda, privacy and downtime policy. No new clinical rule is activated.
4. Full accessibility, reception-minimal access, department restrictions, managed display devices/session handling, clinical usability and provider backup/recovery remain incomplete. Local transport recovery does not supply offline clinical writes.

3D supports source review and a deliberately labelled local synthetic software walkthrough. It does not authorise a clinical pilot, hosted migration or deployment. Stop after this milestone; obtain explicit scope and approvals for the next work.

## INFORMATION FOR CHATGPT — MILESTONE 3E

- Preserve the stack, prior uncommitted source and all patient/history/reference formats. No stage, commit, push or hosted operation occurred in 3D.
- New migration is `202610190001_necms_bounded_reads.sql`; it ran only in disposable local engines. Cursor metadata is private; clinical records were not backfilled or assigned ownership.
- Default screens use bounded checked reads, explicit patient search, full-scope summaries and separate history/evidence pages. Unknown urgency, manual decisions, immutable evidence and independent assessment review remain. Raw clinical realtime stays disabled.
- Local results are 44 frontend tests, 106 Django tests, successful build, new SQL 17 assertions/28 negative probes, existing SQL/browser checks and 14 actual PostgreSQL concurrency/recovery checks. Browser/Auth upstreams are mocked; local SQL Auth is stubbed. Do not call this hosted Supabase integration.
- Review performance/compatibility caveats before adding features: O(scope) revisions/counts, offset scans, conservative cursor restarts, legacy unbounded endpoints/staff administration and old resource-dialog limits. Production-like load and direct REST privilege/projection review remain.
- Use the synthetic harness and reset only as documented. Hospital walkthrough acceptance and clinical governance remain unsigned. No clinical automation, real patient data or hosted execution is authorised by these reports.
- Verify an exact isolated Supabase target and its schema/history, accounts, recovery and execution approval before real Auth/REST/RLS negative tests or migrations. Agree 3E scope explicitly; do not infer permission to deploy or activate clinical protocols.
