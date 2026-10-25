import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    port: 5173, strictPort: true,
    // /api/*.ts are frontend ESM modules under root:src/web, not HTTP API calls.
    proxy: { '^/api/v1(?:/|$)': 'http://127.0.0.1:3000', '/health': 'http://127.0.0.1:3000' },
  },
});
