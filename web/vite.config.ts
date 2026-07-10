import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxies /api to the local RingLeader server. In production the frontend
// is deployed to Butterbase and /api is served by Butterbase functions.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: { outDir: 'dist' },
});
