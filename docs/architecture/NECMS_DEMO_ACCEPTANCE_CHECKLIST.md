# NECMS synthetic demonstration acceptance checklist

2026-10-19. This checklist does not approve a live clinical pilot or deployment. Technical observations and hospital sign-off are separate.

## Local technical evidence

- [x] New default coordination reads are hospital/context/capability checked and bounded (default 25, maximum 50).
- [x] Cursor binds user, context, kind, filters, revision, size and offset; stale/expired/forged continuations fail explicitly.
- [x] Full-scope summary counts survive an empty filtered page; unknown urgency is independently visible.
- [x] Search and department/service/state/triage/urgency/team/person filters execute on the server with independent SQL validation.
- [x] Patients, histories, evidence, acknowledgements, catalogues and staff lookups have bounded retrieval; no automatic merge.
- [x] New history/patient selection data is invalidated immediately when its scope/selection changes, and histories are not refetched on each queue poll.
- [x] Explicit call/start/accept/defer/reassign/complete/review controls retain their server authority and immutable history.
- [x] Membership/capability revocation, cross-hospital access, malformed/excessive parameters and stale cursors have negative tests.
- [x] Real local concurrency proves nonblocking page reads and stale continuation rejection after a concurrent commit.
- [x] Local dump/restore preserves 35 tables plus function/ACL/RLS/policy evidence.
- [x] Separate browser tests cover paging/search/counts, staff/hospital/logout/display races and fictional scenarios/reset.
- [x] Performance measured at 100, 1,000, 5,000 and 10,000 active synthetic encounters; limitations are reported.

These boxes refer to executed local tests described in the completion report. They are not declarations of real Supabase integration, clinical efficacy, complete accessibility certification or unrestricted workload capacity.

## Before a stakeholder software walkthrough

- [ ] Named facilitator has rehearsed the complete chosen scenario set on the actual presentation laptop and agreed screen/device setup.
- [ ] Use only `start-paged-test.mjs` plus `demo-necms.mjs`; confirm fictional banner, simulated Auth/API notice and no externally connected browser session.
- [ ] Demonstrate repeated reset and explain that it changes in-memory fixtures only.
- [ ] Explain which results use mocked upstreams and which execute actual PostgreSQL transactions.
- [ ] Check keyboard focus, zoom, text labels/contrast and tablet layout on the meeting's actual hardware; do not rely on colours alone.
- [ ] Agree demonstration duration, scope, stop conditions and capture/recording consent with stakeholders.
- [ ] Keep client credentials, live patient data, real clinical screens and secret-bearing developer tools out of the demonstration.
- [ ] State that provisional labels and configured categories are not approved clinical protocols or treatment recommendations.
- [ ] Avoid claims of measured waiting-time reductions, hospital outcomes or production readiness.

## Before any hosted synthetic demonstration

- [ ] Exact dedicated project/endpoint/owner and synthetic-only classification verified and explicitly approved.
- [ ] Deployed schema/migration ledger compared read-only; no automatic migration-history repair or historical ownership assignment.
- [ ] Reviewed migration impact/checksums, recovery rehearsal, operator, maintenance window and specific execution approval recorded.
- [ ] Actual Supabase Auth/token refresh/expiry/revocation, direct REST/RPC/RLS and restricted display tests passed using least-privilege synthetic users.
- [ ] Reverse proxy/TLS/no-store headers, logs, device sessions and network privacy verified.
- [ ] Manage or disable legacy unbounded read routes for the intended deployment; set reviewed statement/rate/retention limits.
- [ ] Decide department access policy and resolve remaining scale/governance risks.

## Before a live clinical pilot

- [ ] Hospital leadership approves protocols/versions, staff authority, independent review and urgency vocabulary.
- [ ] Hospital approves identity/duplicate handling, service readiness, sequencing review, correction/addendum, handover and downtime responsibilities.
- [ ] Clinical reassessment/escalation rules, if later implemented, undergo separate approval and validation; none are activated by 3D.
- [ ] Privacy/security review, professional credential responsibilities, support, incident handling, audit/retention and recovery objectives approved.
- [ ] Named pilot acceptance owner, scope, training, monitoring and go/no-go criteria recorded.

All hosted and clinical approval boxes remain unverified/unapproved by this milestone. No user credentials or patient records belong in checklist evidence.
