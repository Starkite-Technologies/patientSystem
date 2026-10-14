# NECMS additive migration plan

Status: proposal only. No hosted or application database migration was executed for Milestone 1. The existing database checker used disposable in-memory PGlite. This plan preserves existing patient references, patient/visit/resource UUIDs, encounters and audit history. It does not authorize implementation or production execution.

Prerequisites and access design: [baseline](NECMS_BASELINE.md), [multi-hospital design](NECMS_MULTI_HOSPITAL_DESIGN.md). Release gate: [security test plan](NECMS_SECURITY_TEST_PLAN.md).

## 1. Establish a trustworthy starting point

1. Commit the reviewed application baseline without credentials or patient data. Keep all six existing migration files immutable.
2. Obtain a read-only schema attestation from a database owner: migration ledger if present; catalog definitions for tables/columns, functions including overloads, views, policies/grants, triggers, indexes, sequences, publication and exposed schemas. Compare actual definitions with repository files. The existing zero-row hosted check is insufficient.
3. For manual dashboard migrations without a ledger, reconcile each transformation using catalog evidence. Do not replay old files or insert assumed history. Develop an explicit, reviewed adoption procedure after attestation, separate from clinical data migration. Resolve drift in a new migration.
4. Verify backup/export and restore capabilities and rehearse recovery in an isolated environment. Secure archives and exports outside the repository. Do not assume the free hosting plan provides the required recovery facility.
5. Have the responsible data owner approve record provenance and the mapping process. No default hospital, hardcoded facility assignment, reference-prefix inference or assignment based on the most recent staff member is acceptable evidence.

## 2. Additive schema phases

These are planned migration groups, not files created in this milestone. Choose new sequence numbers only after reconciling the deployed baseline.

| Phase | Proposed additions | Compatibility boundary |
| --- | --- | --- |
| A: organization | Hospitals, departments, configuration versions, capability vocabulary, hospital roles and role-capability mapping. | No global-role-to-hospital authorization conversion. |
| B: access | Memberships, membership-role/department grants, private access contexts, grants/revocation audit. | No user gets new access merely because a row exists. |
| C: ownership | Nullable `hospital_id`, `ownership_state` and applicable `department_id` on existing patients, visits, resources and audit events; private provenance/quarantine manifest. | Add fields without replacing UUIDs, references, snapshots or timestamps. Existing UI/API remains on the prototype until coordinated security cutover. |
| D: integrity | Supporting unique/composite indexes and FKs; ownership checks; scoped reference/space constraints; idempotency records. | Validate staged data before enabling validated constraints. |
| E: access boundaries | Context helpers, scoped read/write functions, projections, RLS and narrowed grants. | Replace global policies and legacy authorization atomically at cutover. |
| F: delivery | Generic invalidation outbox and restricted display projection; private channel authorization. | Disable raw clinical row subscriptions/public channels before multi-hospital operation. |

Bootstrap of facility administrators and initial memberships is a separately approved restricted administrative operation, with a recorded actor/reason. Normal application users cannot create ownership assignments or self-grant capabilities. Configuration/membership audit is added without altering previous clinical audit events.

## 3. Ownership states and provenance

Existing records initially have nullable ownership with state `pending`. Pending and quarantined rows are inaccessible through NECMS clinical/display APIs after security cutover. New ordinary records must be `verified` with a hospital derived from the validated context; users cannot create pending/quarantined clinical records through normal RPCs.

Ownership invariant:

- `verified`: hospital is non-null and the approved manifest identifies provenance.
- `pending` or `quarantined`: hospital is null; only restricted migration review can access the row.
- State and assignment changes require audited administrative reconciliation, never an ordinary clinical edit.

Hospital IDs need not become globally `NOT NULL` while preserved quarantine rows remain in the original tables. Use state-dependent CHECK constraints instead of deleting or silently relocating unknown records. FKs and policies must also exclude nonverified parents from verified operational relationships; composite keys alone do not enforce state.

The private manifest stores entity type/UUID, proposed owner, disposition, external evidence reference, reviewer, approval time and batch ID. Evidence and actual row mappings are protected administrative material, not committed documentation. Record identifiers and health details must not be printed in migration logs.

For each connected graph of patient, encounters, linked resources and clinical audit events:

1. Confirm the source system/facility and evidence with the data owner.
2. Check whether shared identities/references or resource names were reused across different facilities. A normalized patient may already combine encounters from uncertain origins; do not assume its latest encounter determines ownership.
3. Assign only an internally consistent verified graph. An uncertain/conflicting patient or encounter remains quarantined; its dependent records cannot become ordinary operational rows. Shared resources need independent ownership verification.
4. Attribute audit events from their linked verified entities only where consistent. Resource-only events or unlinked events need independent evidence. Preserve unknown events with null hospital and quarantine state. Do not rewrite embedded old/new JSON to manufacture provenance.
5. Preserve private name/age archives unchanged. Add a private ownership mapping for archive entries using their actual source keys when verified; uncertain entries remain restricted. Inspect archive definitions before designing relationships; do not assume every archive row has a patient UUID.

Quarantine is an access restriction, not a deletion. If unresolved records represent ongoing care, do not conduct operational cutover until hospital staff approve reconciliation or a safe downtime/continuity procedure. Software must not hide active patients from an operational board without a reviewed transition plan.

## 4. Constraints and indexes

Exact DDL must follow catalog attestation; intended invariants are:

| Target | Required constraint/index |
| --- | --- |
| Hospitals | PK UUID; unique stable facility code; valid active state/timezone configuration. |
| Departments | FK hospital; unique `(hospital_id, code)`; unique `(hospital_id, id)` for composite references. |
| Memberships | FK hospital and Auth user; unique `(hospital_id, user_id)`; indexed user/state/hospital; coherent validity window and increasing authorization version. Actor history survives access revocation. |
| Role/grant tables | Composite hospital-aware relationships prevent assigning another hospital's role/department to a membership. Unique grant pairs; explicit capability vocabulary; lookup indexes. |
| Access contexts | Index context UUID lookup, user/membership, expiry/revocation; validate hospital/member binding and version. Private grants; no client mutation. |
| Patients | FK hospital; state/ownership CHECK; unique `(hospital_id, id)`; hospital-scoped unique normalized reference for verified rows, lookup index by hospital/reference. |
| Visits | FK hospital; composite `(hospital_id, patient_id)` and `(hospital_id, resource_id)`; composite department FK; ownership/state checks; indexed hospital/status/priority/arrival and hospital/patient. Retain patient and encounter version guards. |
| Spaces | Hospital/department FKs; unique `(hospital_id, id)`; hospital-scoped normalized name uniqueness; index hospital/state/kind. |
| Active visits | Unique active `(hospital_id, patient_id)` and assigned `(hospital_id, resource_id)` with the existing active-state predicate during Milestone 2. Validate parent ownership. No new clinical closure semantics in this milestone. |
| Audit | Indexed hospital/occurred time and hospital/linked encounter or patient; checked attribution; new event metadata contains actor/membership/context/request ID without editing old records. |
| Idempotency | Unique `(hospital_id, actor_id, operation, request_id)`; digest and result UUID; bounded reviewed retention. Different payload with same key rejects. |
| Outbox | Indexed delivery state/next attempt and hospital; deduplication key; bounded retention; no transmitted clinical payload. |

Optional resource relationships use nullable resource IDs and require a same-hospital parent when assigned. Mandatory patient relationships cannot use null hospital as a loophole. Add parent ownership validation to writes and database constraints/triggers where composite FKs cannot express it. Keep strict direct-write grants.

During transition, global reference and resource-name uniqueness may remain as a stricter compatibility constraint. Remove those global indexes only after hospital-scoped uniqueness is valid and every lookup is scoped. Existing reference strings remain unchanged; the global sequence may continue generating new unique strings initially. Per-hospital counters are unnecessary for isolation and are deferred. Do not reset or renumber the existing sequence. Removing a global index does not itself grant access, but can break old callers relying on unscoped lookup.

Use `NOT VALID` FKs/CHECK constraints where supported, then explicitly validate them. Unique indexes require separate duplicate checks and cannot be made safe by `NOT VALID`. Plan locking and concurrent index creation in appropriate nontransactional steps; the current migration runner wraps each SQL file in a transaction and cannot run `CREATE INDEX CONCURRENTLY` within that transaction. Do not introduce unsupported statements into it without a separately reviewed execution mechanism. Rehearse lock time and rollback in staging.

## 5. Backfill and cutover

Backfill from the approved private manifest in bounded, restartable batches. Record affected counts and batch hashes without clinical contents. Writes during backfill can invalidate ownership evidence: pause affected writes during the final reconciliation window or use a reviewed change-capture process, then reverify counts and relationships. Do not partially enable a second hospital while global policies remain active.

Before cutover, prepare the context-aware API/client, scoped RPCs and policies in staging. Inventory every callable overload and replace/revoke all unscoped paths. In a controlled maintenance window, validate ownership constraints, switch permissions/policies/function grants, disable raw clinical websocket subscriptions, deploy the compatible API/client, and run acceptance checks. Clear old sessions/contexts and ensure the old application fails closed rather than retaining global access.

A PostgreSQL transaction can atomically switch database permissions; it cannot atomically deploy React, Django and hosted Realtime configuration. Use maintenance gating, compatible staged versions and a documented deployment order. No patient care may depend on an untested transition.

## 6. Verification and sign-off

Capture protected pre/post evidence, not patient data in this repository:

- Compare counts and exact sets of patient, encounter, resource and audit UUIDs. Verify every existing reference string and original audit timestamp/actor/snapshot remains unchanged. Compare original columns separately from newly added ownership fields.
- Compare encounter-to-patient/resource links before/after; report unresolved relationships privately. No ownership mismatch or orphaned verified row is allowed.
- Reconcile `verified + pending + quarantined = total` for each entity and map verified counts to approved manifest batches. Verify no unapproved ownership assignment.
- Validate all new constraints and index validity; inspect effective grants/policies/owners/search paths and every function overload. Verify protected archives remain intact and unreadable to ordinary users.
- Run existing regression tests plus the positive/negative security suite, direct REST/RPC tests and real websocket revocation tests in an isolated Supabase environment. Verify active board completeness, paging, stale feedback and context-switch races.
- Test restore and application compatibility. Database owner, security reviewer and responsible hospital operational lead sign off before any live migration is authorized.

## 7. Recovery

On failed additive schema preparation, roll back the current transaction; earlier completed migrations remain recorded. Before cutover, unused additions may remain safely private while forward fixes are developed. Do not delete clinical records or reverse identity normalization to recover from a schema issue.

After cutover, **never restore the old global RLS or global-role authorization as rollback**. Disable affected writes or the feature, keep isolation enforced and use a forward fix. Only roll the application back to a version compatible with context enforcement. Preserve new writes/audit history. A full database restore requires an approved recovery point, outage reconciliation and restore rehearsal; it may lose writes after that point and is not an automatic safe rollback.

Correct a wrongly attributed row through an audited, privileged provenance review of the entire linked graph. Prevent new cross-hospital relationships during correction, invalidate relevant contexts/notifications and retain original audit evidence. Do not silently relabel records or regenerate references.

Major risks are unknown deployment drift, manual migration history, ambiguous ownership, historical identity aggregation, old function/policy bypasses, index/DDL locks, deployment mismatch, row-limit omissions and weak recovery facilities. These are release blockers until verified, not assumptions to hide in a migration script.
