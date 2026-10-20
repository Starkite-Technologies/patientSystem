// Presentation mode uses only the dedicated browser-intercepted fictional service.
process.env.VITE_NECMS_PRESENTATION='true';
process.env.NECMS_PREVIEW_PORT='5177';
await import('./start-paged-test.mjs');
