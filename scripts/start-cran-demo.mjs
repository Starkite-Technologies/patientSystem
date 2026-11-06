// PatientFlow CRAN demo: one command starts Django (API, FHIR, mock registry) and the web app.
// Synthetic data only. Never touches the pilot's Supabase project or ports (8000 / 4173).
//   npm run demo:cran            -> http://127.0.0.1:5180
//   npm run demo:cran:public     -> production build + public https://<random>.trycloudflare.com link
//                                   (runs on this laptop; the link stops when you press Ctrl+C)
// Optional: ANTHROPIC_API_KEY and ANTHROPIC_MODEL in .env.cran (or the environment) enable the AI.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const API_PORT = process.env.CRAN_API_PORT || '8010';
const WEB_PORT = Number(process.env.CRAN_WEB_PORT || 5180);
const PUBLIC = process.argv.includes('--public');

// Demo-only settings file (git-ignored). Values already in the environment win.
const extra = {};
const file = join(root, '.env.cran');
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (m && !(m[1] in process.env)) extra[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const demoEnv = {
  ...extra, ...process.env,
  CRAN_DEMO: 'true', DJANGO_DEBUG: 'true', NECMS_ENABLED: 'false',
  // Blank the pilot's Supabase settings so .env cannot point the demo at real data.
  SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', DATABASE_URL: '',
  VITE_CRAN_DEMO: 'true', VITE_NECMS_ENABLED: 'false', API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
};
Object.assign(process.env, demoEnv);

const python = [join(root, '.venv', 'Scripts', 'python.exe'), join(root, '.venv', 'bin', 'python')].find(existsSync) || 'python';
const django = spawn(python, ['backend/manage.py', 'runserver', `127.0.0.1:${API_PORT}`, '--noreload'], { cwd: root, env: demoEnv, stdio: 'inherit' });
django.on('exit', code => { console.error(`Django stopped (${code}).`); process.exit(code ?? 1); });

const vite = await import('vite');
let server, tunnel;
if (PUBLIC) {
  // Production bundle (fast over the internet) with the same /api and /fhir proxy. Never touches dist/ (pilot).
  await vite.build({ root, logLevel: 'warn', build: { outDir: 'dist-cran', emptyOutDir: true } });
  server = await vite.preview({ root, build: { outDir: 'dist-cran' }, preview: { host: '127.0.0.1', port: WEB_PORT, strictPort: true } });
  const exe = ['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe'].find(existsSync) || 'cloudflared';
  tunnel = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${WEB_PORT}`], { cwd: root });
  const watch = chunk => {
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString())?.[0];
    if (url) console.log(`\n  PUBLIC LINK: ${url}\n  Synthetic demo data. Anyone with the link can use it, including Reset demo.\n`);
  };
  tunnel.stdout.on('data', watch);
  tunnel.stderr.on('data', watch);
  tunnel.on('exit', code => console.error(`Cloudflare tunnel stopped (${code}).`));
} else {
  server = await vite.createServer({ root, server: { host: '127.0.0.1', port: WEB_PORT, strictPort: true } });
  await server.listen();
}
console.log(`\n  PatientFlow CRAN demo: http://127.0.0.1:${WEB_PORT}\n  AI: ${process.env.ANTHROPIC_API_KEY ? `on (${process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'})` : 'off - rule-based engine'}\n  Ctrl+C to stop.\n`);
const stop = () => { django.kill(); tunnel?.kill(); Promise.resolve(server.close()).finally(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
