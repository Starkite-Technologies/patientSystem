# PatientFlow laptop pilot

The existing pilot uses self-hosted Supabase on this laptop and the named Cloudflare tunnel at https://patientflow.starkitetechnologies.com. Keep the existing database and NECMS source functionality. Do not create a new Supabase project. Use fictional patients only.

## Existing configuration

- Supabase stack: `C:\Users\alexs\patientflow-supabase\upstream\docker`, outside OneDrive.
- Gateway: `127.0.0.1:8100`; Django via Waitress: `127.0.0.1:8000`; frontend preview: `127.0.0.1:4173`.
- Tunnel configuration: `%USERPROFILE%\.cloudflared\patientflow.yml`. Its only hostname routes to `http://127.0.0.1:4173`; unmatched hostnames return 404.
- Frontend uses `VITE_SUPABASE_URL=same-origin`; only Auth is proxied directly. Patient operations use Django and user-scoped RLS.
- `NECMS_ENABLED=false`, `VITE_NECMS_ENABLED=false`. Multi-hospital functionality remains in source and has separate synthetic tests.
- Six legacy migrations and `202610270001_pilot_export_audit.sql` are already applied. The export migration filename has a future date, but its applied checksum matches; do not rename or edit it.
- The pilot refreshes every 30 seconds. Realtime is not publicly proxied.

## Read-only checks

Run these from the repository root in PowerShell. RTK is the configured command wrapper.

```powershell
rtk proxy .\.venv\Scripts\python.exe backend/manage.py check_supabase
rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File deploy/selfhost/apply-legacy-migrations.ps1
rtk proxy powershell -NoProfile -Command 'Get-Content deploy/pilot-verify.sql -Raw | docker exec -i supabase-db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1'
rtk proxy powershell -NoProfile -Command '& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --config "$env:USERPROFILE\.cloudflared\patientflow.yml" ingress validate'
```

Expect Auth verified, anonymous board access blocked, zero pending migrations, and 13 PASS rows. The migration command above is preview only. Do not add `-Apply` without explicit approval and a verified backup/restore plan. Its apply path has not been rehearsed in this review; there are no pending migrations to apply.

## Isolated software checks

```powershell
rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-isolated-checks.ps1
```

This uses synthetic sessions and embedded databases. Its build goes to `test-results/isolated-build`, leaving the frontend currently served from `dist` untouched. Do not run a normal build against the running pilot before release approval.

For the fictional legacy board, start this in one terminal:

```powershell
rtk proxy node scripts/start-demo.mjs
```

Open http://127.0.0.1:5174. In another terminal:

```powershell
rtk proxy powershell -NoProfile -Command '$env:PREVIEW_URL="http://127.0.0.1:5174"; node scripts/check-browser.mjs'
```

For the coordinator export UI, run `rtk proxy node scripts/start-export-test.mjs`, then `rtk proxy node scripts/check-export-browser.mjs` in another terminal. That harness uses mocked Auth/API and blocks external requests. Stop only these test servers with Ctrl+C when finished.

## Laptop DNS

On 26 October 2026 the router resolver `192.168.1.1` returned NXDOMAIN. Both `1.1.1.1` and `8.8.8.8` resolved the hostname. HTTPS returned 200 when curl used a public address with the correct hostname and certificate validation. This locates the failure in the router/upstream DNS path; a cached negative answer is a possible cause, not proven.

```powershell
rtk proxy powershell -NoProfile -Command 'Resolve-DnsName patientflow.starkitetechnologies.com -Server 192.168.1.1 -DnsOnly'
rtk proxy powershell -NoProfile -Command 'Resolve-DnsName patientflow.starkitetechnologies.com -Server 1.1.1.1 -DnsOnly'
rtk proxy curl.exe --silent --show-error --max-time 20 --resolve patientflow.starkitetechnologies.com:443:104.21.94.2 -o NUL -w "%{http_code}\n" https://patientflow.starkitetechnologies.com/api/health/
```

The address above was verified on the review date and may change; use the current A record from the public lookup if needed. `--resolve` affects only that request. Never pin Cloudflare edge addresses in the hosts file or recreate the DNS route to solve a laptop resolver problem.

If you choose to change the laptop resolver, the following requires an Administrator PowerShell. It changes only Wi-Fi DNS, and has not been executed:

```powershell
rtk proxy powershell -NoProfile -Command 'Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses 1.1.1.1,1.0.0.1; Clear-DnsClientCache'
```

Restore the previous DHCP-provided resolver:

```powershell
rtk proxy powershell -NoProfile -Command 'Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses; Clear-DnsClientCache'
```

Do not restart the router, release the network adapter, stop cloudflared, or change public DNS while the pilot is in use. Cloudflare explains negative DNS caching in its [DNS troubleshooting guide](https://developers.cloudflare.com/dns/troubleshooting/dns-issues/).

## HTTPS gate before public pilot use

The public HTTPS endpoint works, but HTTP currently returns 200 without a redirect. Do not enter credentials on the HTTP URL. A source guard now blocks staff client creation on public HTTP, but that change is not deployed.

After approval, configure an HTTP-to-HTTPS redirect for this hostname in Cloudflare and verify it returns 301 or 308 with the HTTPS Location. Cloudflare's [Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/) setting affects the whole zone; obtain approval for that wider effect or use a rule limited to the PatientFlow hostname. No Cloudflare settings were changed in this review.

```powershell
rtk proxy curl.exe --silent --show-error --max-time 20 --resolve patientflow.starkitetechnologies.com:80:104.21.94.2 -D - -o NUL http://patientflow.starkitetechnologies.com/
```

The current public HTML also lacks frame protection and HSTS. `manage.py check --deploy` reports W002, W003, W004 and W008. Bearer-token API requests do not use Django cookie sessions, but the missing edge protections and redirect still need a release review. A working HTTPS certificate alone does not enforce HTTPS.

## Staff acceptance using fictional records

Use http://127.0.0.1:4173 on this laptop until DNS and public HTTPS enforcement are resolved. Sign in as the existing coordinator. Register a clearly fictional patient with presenting complaint `PILOT-FICTIONAL-20261026`. Leave any existing unclassified patient untouched. No staff passwords or tokens should be pasted into chat, shell arguments, or reports.

Run the new secure acceptance command, replacing only the email:

```powershell
rtk proxy .\.venv\Scripts\python.exe backend/manage.py check_pilot_session --email YOUR_COORDINATOR_EMAIL
```

It prompts for the password without echoing it, signs in with the real Auth service, reads the running board, exports only matching fictional visits, and checks for a new Activity log entry. It discards the CSV and logs out only its own new session. It intentionally leaves the real export audit event in place. For a surgeon, clinician, nurse or viewer account, the same command verifies board access and export refusal. No password was available during the automated review, so this interactive acceptance step is still pending.

In the UI, also export from Completed visits after discharging the fictional visit; verify your name, time, reference and export summary in Activity log. Confirm that surgeon/nurse/viewer accounts have no Export button and that non-coordinators cannot call the endpoint. Clinical role changes must follow hospital policy.

For a larger fictional fixture set, the existing command can add ten marked examples. It writes to the existing database; run only when you intend to add these fixtures:

```powershell
rtk proxy .\.venv\Scripts\python.exe backend/manage.py seed_demo_patients --email YOUR_COORDINATOR_EMAIL
```

Do not reset or delete the database for a pilot. The browser-only demo already has fictional records and needs no database changes. Across two signed-in devices, verify changes appear within the 30-second refresh interval. Actual device synchronisation, staff passwords, backups/restore, clinical policy approval and availability remain acceptance tasks.

## Release approval

No commits, deployment, migration application or production process restarts are authorised by this guide. Review the diff and obtain approval before building into `dist`, restarting the app, altering Cloudflare settings or committing. The running pilot still serves the pre-review build and backend processes.

Before real patient use, replace laptop preview hosting with reviewed production hosting, validate backups and restore, agree access roles and clinical triage policy, and confirm data-protection requirements. Cloudflare terminates public TLS outside the application process, so self-hosting alone does not establish that data never leaves Namibia.
