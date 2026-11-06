import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const proxy: Record<string, string | { target: string; changeOrigin: boolean }> = { '/api': 'http://127.0.0.1:8000' };
  // Self-hosted Supabase: expose only Auth under this origin; patient data goes through Django.
  if (env.VITE_SUPABASE_URL === 'same-origin' && env.SUPABASE_URL) proxy['/auth/v1'] = { target: env.SUPABASE_URL, changeOrigin: true };
  // Public hostname served through the named tunnel; any other Host header is rejected (preview inherits this).
  const allowedHosts = env.PUBLIC_HOSTNAME ? [env.PUBLIC_HOSTNAME] : [];
  return {
    plugins: [react(), tailwindcss()],
    server: { proxy, allowedHosts },
  };
});
