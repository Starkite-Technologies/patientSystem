# PatientFlow pilot deployment (single surgeon, urgency board only)

Scope: one department, one surgeon (Dr. Nashidengo) plus the staff who coordinate the board.
Feature in use: the colour-coded P1–P5 urgency board (legacy single-department mode).
NECMS multi-hospital mode stays **off** (`NECMS_ENABLED=false`, `VITE_NECMS_ENABLED=false`).

Two steps below are gated: **⛔ APPROVAL** marks steps that change a database or make
the app publicly reachable. Do not run them without explicit sign-off.

## Why a new Supabase project

The existing project (`znltmxajrztszhjuamak`) already has the seven NECMS migrations
(`202610140006` through `202610200001`). Migration `202610140006_necms_hospital_isolation.sql` drops the legacy
read policies and makes `save_visit` / `set_resource_state` require a hospital membership.
With NECMS flags off, that project shows an **empty board and rejects every save**.

The pilot therefore uses a fresh project with only the five legacy migrations
(0001 to 0005). Leave the existing project untouched as the NECMS development target.

## Architecture

```
Browser ──HTTPS──> Caddy (VM, ports 80/443, auto Let's Encrypt)
                     ├─ /api/*  → gunicorn + Django on 127.0.0.1:8000 ──HTTPS──> Supabase Data API (user's JWT, RLS)
                     └─ /*      → /opt/patientflow/dist (built React app)
Browser ──HTTPS/WSS──> Supabase Auth + Realtime (publishable key only)
```

One VM, one domain, same origin; no CORS, no service-role key anywhere.

## Part A: Supabase pilot project

1. Create a project named `patientflow-pilot`.
   - Plan: **Pro** (Free pauses inactive projects and has no backups).
   - Region: `eu-central-1` (Frankfurt), or whichever region your hospital's data-protection review accepts.
     Put the VM in the same region.
   - Store the database password in a password manager. It is not needed by the app.
2. Authentication → Sign In / Providers:
   - Turn **off** "Allow new users to sign up" (the publishable key is public; without this anyone can create an Auth user).
   - Turn **off** anonymous sign-ins. Keep email confirmation on.
   - Minimum password length: 12 or more.
3. Authentication → URL Configuration: Site URL `https://pilot.example.com` (your domain).
4. **⛔ APPROVAL: apply migrations.** In SQL Editor, run each file in order, one at a time, confirming success:
   1. `supabase/migrations/202610130001_initial.sql`
   2. `supabase/migrations/202610140001_normalize_names.sql`
   3. `supabase/migrations/202610140002_nurse_surgeon_roles.sql`
   4. `supabase/migrations/202610140003_nurse_coordination.sql`
   5. `supabase/migrations/202610140004_patient_date_of_birth.sql`
   6. `supabase/migrations/202610140005_auto_patient_references.sql`

   **Stop there. Do not run any `*necms*` file.** (`manage.py apply_supabase_migrations` refuses to run
   while NECMS files exist in the folder, so the SQL Editor is the intended path.)
5. Run `deploy/pilot-verify.sql` in the SQL Editor (read-only). All 12 rows must say **PASS**: tables, RLS,
   Realtime publication (`visits`, `resources`, `patients`), no NECMS objects, and write functions closed to `anon`.
   The schema seeds five example spaces (Resus 01, Treatment 02–04, Theatre 01); rename them to the department's real spaces before go-live.
6. Authentication → Users → Add user: create Dr. Nashidengo and each coordinating staff member
   (email + strong temporary password, "auto confirm"). Then in SQL Editor:

   ```sql
   insert into public.staff_profiles (id, first_name, last_name, role)
   values ('AUTH_USER_UUID', 'FIRST', 'Nashidengo', 'surgeon');
   ```

   Surgeons cannot mark spaces available, cleaning or unavailable. At least one `nurse` or `coordinator`
   is needed for that. Use `viewer` for a wall display account.
7. Project Settings → API: copy the **Project URL** and **publishable key** (never the secret key).

## Part B: Server (one Ubuntu 24.04 VM)

Size: 1 vCPU / 2 GB is plenty. Any provider (Hetzner, DigitalOcean, Lightsail...), same region as Supabase.

1. Create the VM with **SSH-key login only**. Firewall: allow 22 (ideally from your IP only), 80, 443.
2. DNS: `A` record `pilot.example.com` → VM public IP. Wait until it resolves.
3. Base setup:

   ```bash
   sudo apt update && sudo apt -y upgrade
   sudo apt -y install unattended-upgrades python3-venv python3-pip git curl debian-keyring debian-archive-keyring apt-transport-https
   sudo dpkg-reconfigure -plow unattended-upgrades
   ```

4. Node.js 22 (build only) and Caddy:

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt -y install nodejs
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt -y install caddy
   ```

5. App user and code:

   ```bash
   sudo useradd --system --home /opt/patientflow --shell /usr/sbin/nologin patientflow
   sudo git clone https://github.com/Starkite-Technologies/patientsystem /opt/patientflow
   sudo chown -R patientflow:patientflow /opt/patientflow
   ```

6. Environment: copy `deploy/env.production.example` to `/opt/patientflow/.env`, fill it in, then:

   ```bash
   sudo chown patientflow:patientflow /opt/patientflow/.env && sudo chmod 600 /opt/patientflow/.env
   ```

7. Build and install:

   ```bash
   cd /opt/patientflow
   sudo -u patientflow npm ci
   sudo -u patientflow npm run build
   sudo -u patientflow python3 -m venv .venv
   sudo -u patientflow .venv/bin/pip install -r backend/requirements.txt
   sudo -u patientflow .venv/bin/python backend/manage.py check --deploy
   sudo -u patientflow .venv/bin/python backend/manage.py check_supabase
   ```

   `check --deploy` reports exactly four warnings (W002 X-Frame-Options, W003 CSRF, W004 HSTS, W008 SSL redirect).
   All are expected: Caddy sets X-Frame-Options/HSTS and redirects to HTTPS, and the API uses bearer tokens, not cookies, so CSRF does not apply.
   Any *other* warning or error must be fixed before continuing.
   `check_supabase` must pass (Auth reachable, anonymous board access blocked).

8. Django service:

   ```bash
   sudo cp deploy/patientflow.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now patientflow
   curl -s http://127.0.0.1:8000/api/health/   # {"status":"ok","supabase_configured":true}
   ```

9. **⛔ APPROVAL: go live.** Edit `deploy/Caddyfile` (domain + `YOUR_PROJECT`), then:

   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
   ```

## Part C: Verify before Dr. Nashidengo uses it

- `https://pilot.example.com` loads with a valid certificate; `http://` redirects to `https://`.
- No "demo" banner and no hospital selector (confirms connected mode with NECMS off).
- `curl -i https://pilot.example.com/api/board/` returns **401** without a token.
- Sign in as the surgeon. Register a *fictional* test patient, then change urgency P1 → P3 and check the colour changes.
- Open a second signed-in device: the change appears within seconds (Realtime) or at most 30 s.
- Sign in as the nurse/coordinator: mark a space "cleaning". Surgeon account cannot.
- Discharge the test patient so it leaves the active board.

## Updating

```bash
cd /opt/patientflow && sudo -u patientflow git pull
sudo -u patientflow npm ci && sudo -u patientflow npm run build
sudo -u patientflow .venv/bin/pip install -r backend/requirements.txt
sudo systemctl restart patientflow
```

Never pull new `*necms*` migrations into the pilot database.

## Before real patient data (not technical, but blocking)

- Hospital sign-off on what P1–P5 and each colour mean (README: priorities are illustrative, not a triage algorithm).
- Data-protection approval for hosting patient identifiers in the chosen Supabase/VM region.
- Paper fallback for outages; who to call if the board is down.
- MFA is not enforced: use strong unique passwords and sign out on shared devices.
  Display mode hides names but is not a security boundary.
- Supabase Pro daily backups enabled; confirm you can see one in Database → Backups after day 1.
