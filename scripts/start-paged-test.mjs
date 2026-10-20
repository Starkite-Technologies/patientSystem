// Synthetic-only bounded UI preview; never reads a real project endpoint.
process.env.VITE_SUPABASE_URL='https://isolated-test.supabase.invalid';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='synthetic-browser-key';
process.env.VITE_NECMS_ENABLED='true';process.env.VITE_SYNTHETIC_DEMO='true';process.env.VITE_NECMS_PAGED_READS='true';
const {createServer}=await import('vite');
const port=process.env.NECMS_PREVIEW_PORT==='5177'?5177:5176;
const server=await createServer({server:{host:'127.0.0.1',port,strictPort:true}});await server.listen();server.printUrls();
