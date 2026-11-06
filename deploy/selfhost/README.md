# Self-hosted Supabase for the PatientFlow pilot

Requirement: patient data stays in Namibia. Supabase runs in Docker on hardware we control,
first this laptop (fictional patients only), later a server in a Namibian data centre (e.g. Paratus Armada).

## Pieces

| What | Where | In git? |
|---|---|---|
| Upstream compose files | `C:\Users\alexs\patientflow-supabase\upstream\docker`, sparse clone of `github.com/supabase/supabase` at **`f4d6d9052788b70c7c712e552fe98b1af8649a73`** (2026-10-26) | Upstream repo, unmodified |
| Stack secrets | `...\upstream\docker\.env` (generated: Postgres, JWT, anon/service keys, Studio login, encryption keys) | Ignored. **Outside OneDrive.** |
| PatientFlow overrides | `deploy/selfhost/docker-compose.patientflow.yml` | Yes |
| Migrations | `deploy/selfhost/apply-legacy-migrations.ps1` (six legacy files + pilot export audit + pilot theatre list; never NECMS) | Yes |
| App config | `patientsystem/.env`: `VITE_SUPABASE_URL=same-origin`, `SUPABASE_URL=http://127.0.0.1:8100`, anon key | Ignored |

The stack lives outside OneDrive on purpose: database files in a synced folder would be uploaded
to Microsoft's cloud (outside Namibia) and can be corrupted while Postgres is running.

## What runs, and what is reachable

Services: `db auth rest realtime meta studio api-gw` (Envoy gateway). Not started: storage, imgproxy,
Edge Functions, Supavisor (which would publish Postgres on host ports 5432/6543).

```
Browser ──tunnel──> vite preview :4173 ── /api/*     ──> Django :8000 ──> gateway :8100 /auth/v1, /rest/v1 (user JWT, RLS)
                                      └── /auth/v1/* ──> gateway :8100 (sign-in only)
                                      └── /*         ──> dist/ (built app)
```

- Gateway published on `127.0.0.1:8100` only; Postgres has no host port at all.
- The browser reaches **only** `/auth/v1`. Data API, Realtime, Studio and `/pg/` stay on the laptop.
- The current board does not use Realtime (it refreshes every 30 s), so the websocket is not proxied.
- Auth: sign-up, phone and anonymous logins are disabled; `start.ps1` refuses to run if any is re-enabled.
- Studio: `http://127.0.0.1:8100` on this laptop, login from `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` in the stack `.env`.

## First run (in order)

1. Docker Desktop running (`docker run --rm hello-world` works).
2. `start.ps1 -StackOnly`: pulls images (~3 GB), starts the stack, checks the loopback binding and Auth settings.
3. ⛔ **Approval required.** Preview, then apply migrations:
   `deploy\selfhost\apply-legacy-migrations.ps1` (lists pending files, changes nothing), then the same with `-Apply`.
   It runs `deploy/pilot-verify.sql` at the end: 14 rows, all PASS.
4. Studio → Authentication → Add user (auto-confirm) for each staff member; Studio → SQL editor → `staff_profiles` inserts
   (same SQL as `deploy/PILOT_DEPLOYMENT.md` Part A step 6).
5. `start.ps1 -NoTunnel` for a local test at `http://localhost:4173`, then `start.ps1` for the tunnel link.

## Moving to a Namibian server later

Same upstream commit, same override file, freshly generated secrets on the server (never copy the laptop `.env`).
Differences: Docker Engine on Linux instead of Docker Desktop; Caddy (`deploy/Caddyfile`) instead of
vite preview + tunnel, with `/auth/v1/*` also proxied to `127.0.0.1:8100`; full-disk encryption; scheduled
`pg_dump` backups to a second Namibian location; Studio reached only over an SSH tunnel.
