// Isolated local QA preview. Never reads or changes live Supabase data.
process.env.VITE_SUPABASE_URL = '';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = '';
process.env.VITE_NECMS_ENABLED = 'false';
const { createServer } = await import('vite');
const server = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } });
await server.listen();
server.printUrls();
