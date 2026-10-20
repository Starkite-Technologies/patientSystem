# Supabase verification preparation

2026-10-20. **Preparation only; no hosted schema or record inspection completed. No hosted deployment authorised.**

## Verified locally

- Supabase CLI: **2.120.0**, executed using the installed Node entry. The first sandbox attempt could not write the CLI's normal profile telemetry; a permitted retry succeeded. A Windows command-shim attempt also failed; the direct installed entry resolved that execution issue.
- Authentication: the read-only project-list command reported **login required**. No access token was displayed or requested in chat; project metadata was not retrieved.
- The ignored application `.env` contains a configured Supabase URL/publishable key. Only variable names, presence and the project reference were inspected/reported; values were not printed.
- Configured reference: **`znltmxajrztszhjuamak`**. This is the application's configured target, not proof of ownership, project purpose, isolation or synthetic-only contents.
- No `.env.local`, `supabase/config.toml`, CLI project-ref or pooler-url link file was present. No process-level access token, database password or database URL was available. Cached credentials were not dumped; the actual project-list failure is the authentication evidence.
- Thirteen repository migrations and twelve SQL test/fixture files exist. Existing local synthetic test/recovery evidence is in the 3E completion report; none is hosted Supabase verification.
- The prepared catalogue SQL executed successfully in an empty disposable embedded PostgreSQL database. This validates local syntax/catalogue availability, not hosted privileges, deployed schema or project identity. No patient data was loaded.
- GitHub source baseline is commit `9030009` on `feature/necms-multi-hospital`. Environment files, tokens, generated artifacts and patient exports remain excluded.

## Next user action: interactive authentication

In your own terminal, from this project:

```powershell
npx supabase login
```

Follow the interactive browser flow locally. Do not paste a token, password or secret key into chat. This authenticates the CLI; it does not link a project or apply SQL. If the terminal asks for a personal token, enter it locally using the official flow rather than posting it here.

Then report that login is complete and identify whether `znltmxajrztszhjuamak` is a dedicated synthetic development project, the original PatientFlow project, or of uncertain purpose. If a different dedicated target is intended, provide its project reference only. Existing application configuration is not approval to use the original database for testing.

## Read-only verification after authentication

1. Retrieve project metadata, filter to the expected reference and compare owner-approved name/purpose, organisation, region and database endpoint. Do not display credentials or unrelated project details. CLI membership/access is not proof that the data is synthetic.
2. Obtain the owner's explicit data classification and evidence of intended use. Unknown or conflicting ownership must remain preserved/quarantined; do not infer that existing records all belong to one hospital.
3. Agree read-only schema access: an authorised dashboard SQL editor or approved read-only PostgreSQL connection. A publishable app key cannot prove complete table/function/RLS/ledger state. Do not put database passwords in Git, shell literals or chat. No linking is required for a catalogue query.
4. Review `supabase/verification/necms_catalogue_readonly.sql`. It runs in a read-only transaction, with timeouts, and selects catalogue metadata/hashes only. It never reads patient/Auth-user rows, function bodies, migration statement bodies or stored configuration values. It has **not been executed against Supabase**. Database/server names alone do not establish project identity.
5. Compare tables/columns/nullability/default hashes, constraints/FKs/indexes, function signatures/owners/search paths/ACLs, RLS flags/policies, invoker-view options, triggers and publication membership with the exact repository sequence. Record differences rather than guessing from file names. Hash comparison requires compatible PostgreSQL deparsing; investigate version-related hash differences privately rather than treating every difference as drift.
6. If the migration ledger exists, inspect only version/name metadata with approved privileges. Manually applied dashboard SQL may have no CLI ledger entry. Never replay or repair migrations solely because a ledger entry is missing.
7. Classify ownership using approved privacy-safe aggregate evidence only when target/data access is authorised. Catalogue inspection alone cannot confirm synthetic-only records or hospital provenance. Do not export patient-level information.
8. Verify a target-specific executable backup/restore or forward-recovery procedure, including provider Auth/platform configuration, operator, secure backup location and agreed RPO/RTO. Local PostgreSQL restoration does not establish managed recovery. Do not install Docker, create paid infrastructure or run provider-changing commands.
9. Produce a discrepancy/readiness report, reviewed migration impact and exact migration hashes. Only after identity, classification, compatibility and recovery are verified should a specific hosted execution be proposed for explicit approval. No migration command is authorised by this preparation.

## Blocked/unverified

Project identity/owner metadata and exact PostgreSQL endpoint; dedicated-development purpose; synthetic-only classification; deployed schema/ACL/RLS/publications; applied/manual migration history; ownership aggregates; least-privilege integration accounts; provider recovery; and specific hosted execution approval. No clinical protocol, data change, role grant, seed, reset, repair, project link or deployment was performed.

The existing project is **not approved as an isolated development target** by this report. If it is the original PatientFlow environment or contains uncertain records, stop migration/testing preparation for that target and nominate a separate synthetic environment.

## Local migration manifest

SHA256 values below identify the exact local files reviewed for preparation. These are not a statement of applied hosted migrations. Line-ending changes alter file hashes; use the exact reviewed files and reconcile differences without rewriting deployed history.

| Migration | Local file SHA256 |
| --- | --- |
| `202610130001_initial.sql` | `378ea540f0fcfd5cf602502686a7cdef5c79c3a10bbf10f04d8795d1e1434949` |
| `202610140001_normalize_names.sql` | `b74875c9befc42ab8f4bcbb20730807ed5dcc56142a71555137b168b0686f965` |
| `202610140002_nurse_surgeon_roles.sql` | `af7558b00ee732f63c064a81ff096604a00e8fc0f64d8f4ea21b9524839721bc` |
| `202610140003_nurse_coordination.sql` | `33f106c4ce6449341f3261221ad7d1c43daa1a5d2b1862fdd8e21b72f22dc669` |
| `202610140004_patient_date_of_birth.sql` | `278ffb6ddc5a36da9c0852f19761f6c1cce2576512c3e2b4208b9cf1974a6a03` |
| `202610140005_auto_patient_references.sql` | `4946ec9faf497d32242840cafae15ce6633a0cedccc7cfb615026bf0059f90a6` |
| `202610140006_necms_hospital_isolation.sql` | `80a7d0c491559ee29209f913604be6f020d9e8dc3b830250dad84160141d2a0b` |
| `202610140007_necms_resource_audit_integrity.sql` | `dca40f4ba4b6d711f605b107e78dbaa19a378f36516666659600e36f704290d2` |
| `202610150001_necms_arrival_triage_foundations.sql` | `8f5633cca90c858d223806c110d1ad815546cda0a457f765187a049398069625` |
| `202610150002_necms_coordination.sql` | `f6aaaacaa2a286f74f1c59c130860427a827e3b4167a2d01a452f27ea7b493fd` |
| `202610150003_necms_verification_hardening.sql` | `13ef0b50daf7e70062e0e45b129df8316dc300f4b6eca0f38d5864aa1c98a143` |
| `202610190001_necms_bounded_reads.sql` | `ec5b280055174576917f835f630c9165ce34b8dc0e9a16502a6275df57d5a34b` |
| `202610200001_necms_presentation_summaries.sql` | `01ba7deb9974ec1031847aa841d3aa26fb88d0c256a75b869a445096485edfe5` |

See `NECMS_HOSTED_INTEGRATION_RUNBOOK.md` for target-specific migration/recovery gates and `NECMS_3E_COMPLETION_REPORT.md` for the local-versus-hosted evidence boundary. No patient data or credentials belong in verification evidence committed to Git.
