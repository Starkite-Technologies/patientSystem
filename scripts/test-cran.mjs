// Runs the CRAN demo backend tests with the pilot's Supabase settings blanked.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const root = join(import.meta.dirname, '..');
const python = [join(root, '.venv', 'Scripts', 'python.exe'), join(root, '.venv', 'bin', 'python')].find(existsSync) || 'python';
const env = { ...process.env, DJANGO_DEBUG: 'true', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', ANTHROPIC_API_KEY: '' };
const result = spawnSync(python, ['backend/manage.py', 'test', 'cran', '--verbosity', '1'], { cwd: root, env, stdio: 'inherit' });
process.exit(result.status ?? 1);
