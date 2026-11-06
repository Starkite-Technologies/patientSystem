import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const api = env.API_PROXY_TARGET || 'http://127.0.0.1:8000';
  const proxy: Record<string, string | { target: string; changeOrigin: boolean }> = { '/api': api };
  // CRAN demo only: FHIR R4 API and the mock national registry.
  if (env.VITE_CRAN_DEMO === 'true') Object.assign(proxy, { '/fhir': api, '/mock-mpi': api });
  // Self-hosted Supabase: expose only Auth under this origin; patient data goes through Django.
  if (env.VITE_SUPABASE_URL === 'same-origin' && env.SUPABASE_URL) proxy['/auth/v1'] = { target: env.SUPABASE_URL, changeOrigin: true };
  // Public hostname served through the named tunnel; any other Host header is rejected (preview inherits this).
  // CRAN demo: only its own subdomain (start-cran.ps1) and quick-tunnel links (npm run demo:cran:public).
  const allowedHosts = env.VITE_CRAN_DEMO === 'true'
    ? [...(env.CRAN_PUBLIC_HOSTNAME ? [env.CRAN_PUBLIC_HOSTNAME] : []), '.trycloudflare.com']
    : env.PUBLIC_HOSTNAME ? [env.PUBLIC_HOSTNAME] : [];
  return {
    plugins: [react(), tailwindcss(), {
      name: 'cran-demo-entry',
      transformIndexHtml: { order: 'pre' as const, handler: (html: string) => env.VITE_CRAN_DEMO === 'true' ? html.replace('/src/main.tsx', '/src/cran/main.tsx').replace(/<title>.*<\/title>/, '<title>PatientFlow - CRAN demo</title>') : html },
    }],
    preview: { proxy, allowedHosts },
    server: { proxy, allowedHosts, watch: { ignored: ['**/backend/**', '**/.venv/**', '**/logs/**'] } },
  };
});
