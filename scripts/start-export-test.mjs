// Fictional connected-mode UI only; browser test blocks all external requests.
process.env.VITE_SUPABASE_URL = 'https://isolated-test.supabase.invalid';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'synthetic-browser-key';
process.env.VITE_NECMS_ENABLED = 'false';
process.env.VITE_SYNTHETIC_DEMO = 'false';
const { createServer } = await import('vite');
const server = await createServer({ server: { host: '127.0.0.1', port: 5178, strictPort: true } });
await server.listen(); server.printUrls();
