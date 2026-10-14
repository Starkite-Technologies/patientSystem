# NECMS security acceptance test plan

Status: specification for Milestone 2. **These NECMS tests have not been implemented or executed.** Existing executed baseline tests are listed in [NECMS_BASELINE.md](NECMS_BASELINE.md); their passing results do not prove multi-hospital isolation.

Targets: [design](NECMS_MULTI_HOSPITAL_DESIGN.md) and [migration plan](NECMS_MIGRATION_PLAN.md).

## Test environments and evidence

Use automated tests in three layers: Django unit/API tests with mocked upstream failures; real PostgreSQL multi-connection integration tests for RLS/functions/constraints/locking; and a disposable configured Supabase project for genuine Auth, PostgREST, private Broadcast and revocation behavior. PGlite is useful for regressions but cannot substitute for hosted websocket authorization or real concurrent connections.

Future fixtures contain isolated synthetic records for facilities A/B, departmental scopes, single-facility staff, dual-facility staff, revoked/expired members, no-membership staff, a membership administrator and restricted display identities. Fixture creation is restricted to approved disposable environments when implementation is authorized. No real patients, production tokens, or actual record exports are used. Milestone 1 creates no new patient fixtures.

Every case specifies principal, token, context, transport, operation, expected response and database outcome. Capture sanitized request IDs, status codes, counts and schema evidence; never record tokens, names, DOBs, notes or screenshots of real patient boards. Assert both absence of response data and absence of unauthorized changes/audit events. Use an administrative test connection only to verify outcomes or arrange fixtures, never as the actor under test.

## Mandatory positive and negative matrix

| ID | Positive case | Negative case and required result | Layers |
| --- | --- | --- | --- |
| ISO-01: patient read | A staff with identity-read capability/context sees A's permitted patient projection. | A queries B by ID, filter, joined view and pagination: no B fields/counts returned. Direct REST returns empty/not-found or permission denial consistently. | API, DB, Data API |
| ISO-02: encounter write | Authorized A staff updates A with correct versions; one audit change is committed. | Same caller patches B with its known UUID/versions: denial, no changed columns or forged A audit entry. Repeat via scoped and legacy RPC overloads. | API, DB, RPC |
| ISO-03: dual membership | Dual staff with A context sees/updates A; after explicit issuance of B context can perform B-authorized operations. | A context cannot view/update B even though the user also belongs to B. Mismatched route/header/body denies. No-context requests deny. | API, DB, REST, browser |
| ISO-04: revocation | Active member can read/write; an explicitly reauthorized new context works after legitimate reactivation. | Revoke membership while retaining the original JWT/context: subsequent reads/writes and new channel joins deny. Grant removal, suspension, validity expiry and authorization-version changes also deny. | DB, API, real Auth/Realtime |
| ISO-05: forged IDs | Valid context bound to current user, hospital and scope succeeds. | Forged hospital header, random context, another user's context, altered scope/purpose, expired context or conflicting RPC context rejects. Forged JWT hospital/role claims grant nothing. | API, REST/RPC, DB |
| ISO-06: direct Supabase | Same authorized user/context reads its allowed projection through supported direct Data API path. | Bypass Django with publishable key + A JWT: B tables/views/functions remain inaccessible. Anonymous, missing profile/membership, display-purpose and missing context fail closed. Direct INSERT/UPDATE/DELETE is denied. | Real Data API, DB |
| ISO-07: privileged functions | Capability-bearing context invokes the intended scoped write/read function. | Invoke each security-definer function and each surviving overload with B identifiers or caller-supplied roles/users: deny/no side effect. Default PUBLIC grants, search-path manipulation and unauthorized helper/sequence execution must fail. | Catalog assertions, DB, RPC |
| ISO-08: realtime | A context can join its private topic, receive generic invalidation and refetch authorized A data. | A cannot join B/another user's topic; public topic attempts and client publish fail. Captured messages contain no clinical data or object IDs. Revoked/expired context receives no subsequently routed invalidations and cannot refetch. | Real WebSocket, publisher integration |
| ISO-09: display | Approved display identity/context receives only the server allowlist for its hospital/scope. | Same token cannot fetch clinical board/patients/notes/audit via Django, REST or RPC. Response and websocket capture exclude hidden clinical fields; DOM hiding alone fails the test. | API, DB/RPC, browser/network |
| ISO-10: relationship integrity | A encounter links to A verified patient/resource/department successfully. | Link A encounter to B patient/space/department or pending/quarantined parent: constraints/write checks reject atomically, including privileged fixture inserts for FK verification. | Real PostgreSQL, RPC/API |

Do not declare isolation passed merely because Django rejects a request; independently exercise the database paths available to `authenticated` and `anon`. All accessible schemas/views/function overloads are part of the test inventory.

## Additional capability and privacy cases

- Membership admin can perform delegated membership operations within its hospital; cannot self-elevate, grant nondelegated capabilities, alter B's roles or read clinical details without a separate grant. Global legacy role alone grants no NECMS access.
- Nurse coordination and surgeon editing retain approved hospital behavior. A surgeon lacking resource coordination cannot change space state. A read-only user cannot register/update patients. Name of a role is not sufficient authority.
- Department-limited context cannot read another department's encounters or allocate its spaces. Explicit facility-wide scope succeeds only when authorized. Hospital patient-identity scope follows the confirmed policy.
- Display-context tokens belonging to otherwise clinical staff remain downgraded for that request. Switching purpose requires issuing and validating a new context. Unauthorized projection filters or requested fields cannot expand the allowlist.
- Audit summaries are scoped; original snapshots and private ownership/name/age archives remain inaccessible. Quarantine and manifest rows deny clinical/display access even with known UUIDs. Error differences do not disclose foreign record existence.
- New context endpoint exposes only authorized memberships, never a directory of other users or hospitals. Sensitive HTTP responses use no-store; clinical responses do not enter shared caches or demo localStorage. Logs contain no credentials/clinical payloads.

## Concurrency, revocation and request races

Use separate real PostgreSQL connections and synchronization barriers, not sequential calls advertised as concurrency:

1. Two A encounters compete for one A space: exactly one assignment succeeds; versions/audit are coherent. Attempts to allocate a B space never participate in A allocation.
2. Two stale updates target one encounter/patient: exactly one accepted version transition; rejected operation leaves no partial identity/visit update.
3. Membership revocation competes with a mutation: the documented lock contract holds. A write authorized before revocation may finish before revocation commits; after revocation completion no new write with old context commits. Test lock ordering/deadlock recovery and grant removal too.
4. Repeated registration with the same request ID/payload returns the same saved UUID; changed payload with same key conflicts; another hospital's key does not reveal its response. Test lost response and retry.
5. Start an A board request, switch to B, delay A response: A data never appears under B. Pending dialogs, audit/resource data and channel callbacks clear on context switch. Separate tabs have independently bound contexts.
6. Fill history beyond configured Data API response limits: all active encounters remain discoverable and history is paginated correctly. No foreign records enter pages/counts, and timestamps/stale feedback accurately describe the loaded context.

## Realtime acceptance details

Do not emulate Realtime solely by calling a PostgreSQL helper. Join actual private channels using valid Auth tokens. Capture socket frames and test initial join, reconnect, token refresh, context expiry, grant removal and revocation while connected. Trigger changes in both hospitals and inspect routed outbox delivery.

Supabase caches Broadcast access decisions during a connection; join-only RLS cannot guarantee immediate revocation. Assert that live routing stops delivery to revoked context topics, queued deliveries recheck eligibility, messages never carry patient data, and authorized refetch fails after revocation. An in-flight generic notification is not a clinical-data leak; document the timing boundary rather than claiming retroactive recall. Test disabling public access and removing raw clinical Postgres Changes exposure. [Realtime authorization behavior](https://supabase.com/docs/guides/realtime/authorization).

If private delivery/revocation cannot pass, authorized polling with raw subscriptions disabled is the safe interim transport. This fallback must still meet context, privacy and stale-state tests.

## Migration acceptance and clinical regressions

Run empty-install, attested existing-schema upgrade, manual-ledger discrepancy, interrupted batch, unresolved ownership and forward-recovery scenarios. Assert preserved UUID/ref sets, original audit snapshots, timestamps and links; no blanket backfill. Validate constraints/indexes, absence of legacy permissive policies and default function grants, private archives and unknown-data denial. Verify migration tools do not log connection strings or clinical contents.

Repeat current frontend/Django/database/browser checks against the context-aware application after implementation. Preserve registration/edit, nurse coordination, existing priority ordering, resource locks and version checks while clearly labeling priorities as legacy. These are software regressions; clinical protocol validity and medical safety require a separately approved later process. No test may introduce fictional triage criteria.

## Release gate

Record command/environment/revision, actual pass/fail counts, transport/version and sanitized evidence for every required case. All mandatory cases must pass, or a documented narrower release must disable the affected feature without weakening isolation. A skipped or mocked hosted test is not a pass. Require schema attestation, provenance sign-off, restore rehearsal and security review before authorizing a live migration. Clinical/operational staff must approve continuity and display policies. Milestone 1 only specifies these gates.
