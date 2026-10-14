# NECMS local development safety

Milestone 2A adds repository/test safety only. Existing `.env` targets must be treated as unclassified/live until the owner verifies otherwise. Do not copy clinical data, run the hosted seed command, or invoke migration tooling during this preparation milestone.

## Isolated existing checks

From the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/run-isolated-checks.ps1
```

The process-only execution-policy override does not change machine policy. The script requires existing `node_modules` and `.venv`, executes only existing local checks, uses unreachable loopback connection settings and restores prior environment variables. It does not print those original values or change `.env`. Any attempted unmocked external call targets loopback, not a hospital project. It is not a general-purpose launcher for arbitrary hosted commands.

The database checker executes existing migrations and fictional fixtures inside disposable in-memory PGlite, with mocked Auth and no managed Realtime. There is no persisted clinical database to roll back. Do not treat this as a Supabase deployment rehearsal or a real concurrency test.

The build contains isolation sentinels and must not be published as a clinical application. `dist/` is ignored and replaceable. A later approved deployment needs its own controlled environment/build and validation.

## Fictional browser environment

Terminal 1:

```powershell
node scripts/start-demo.mjs
```

Terminal 2:

```powershell
$env:PREVIEW_URL = 'http://127.0.0.1:5174'
npm.cmd run test:browser
Remove-Item Env:PREVIEW_URL
```

Use a fresh terminal for these commands if a previous PREVIEW_URL needs preserving. Stop the owned preview with Ctrl+C when finished. The existing demo explicitly disables frontend Supabase configuration before Vite loads env files. It runs on loopback, uses fictional browser-local data, and the test creates a separate browser context. Never enter real patient details. Screenshots are ignored; do not commit screenshots from a live clinical board.

Do not substitute `npm run dev` or a production preview for this command: those may load configured hosted values. No changes were made to the normal application's live behavior.

## Future database-backed integration environment

Not created in 2A. Before 2B integration work, authorize either local disposable real PostgreSQL/Supabase tooling or a separate hosted test project. Record its environment classification and enforce an allowlisted test target in future integration tooling. Use separate development credentials held outside Git, a clearly distinct test project, approved cost/configuration and only synthetic data. Missing/ambiguous environment classification must fail closed, without falling back to the current `.env`.

Local Docker/CLI dependencies were not installed or configured and no managed project was created. Such an environment is needed to verify genuine Auth/Data API/private-channel behavior; PGlite and mocked Django HTTP tests cannot prove it. A hostname label alone cannot prove a database is nonproduction.

## Recovery and version control

The local baseline is `d4398bebbc255db5eba107ba6a3415e25513d03e`; development continues on `feature/necms-multi-hospital`. Nothing has been pushed. Review staged diffs and sensitive-file exclusions before each commit; `.gitignore` does not inspect content or remove already tracked secrets.

Prefer a separate checkout or reviewed revert for code recovery; do not discard another person's changes with hard reset. Existing in-memory tests recover by closing the disposable database and rerunning from a fresh instance. Browser tests recover with a fresh isolated browser context; no clinical records are restored from localStorage.

Future database-backed migration rehearsal must verify UUID/reference/audit preservation, maintain protected schema/history evidence, and test restore or forward correction before live execution. If hospital isolation has been introduced, rollback must never reinstate global access policies. Preserve post-cutover writes/audit and use maintenance gating plus a compatible forward fix. See [migration plan](NECMS_MIGRATION_PLAN.md).
