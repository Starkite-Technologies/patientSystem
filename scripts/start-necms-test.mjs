// Fictional browser integration only; never use configured project credentials.
process.env.VITE_SUPABASE_URL = 'https://isolated-test.supabase.invalid';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'synthetic-browser-key';
process.env.VITE_NECMS_ENABLED = 'true';
const { createServer } = await import('vite');
const server = await createServer({ server: { host: '127.0.0.1', port: 5175, strictPort: true } });
await server.listen(); server.printUrls();
