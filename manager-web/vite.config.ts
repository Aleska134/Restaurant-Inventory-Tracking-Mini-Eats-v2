import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Railway serves `vite preview` behind its own domain; allow any host so the
  // deployed app isn't rejected by Vite's host check.
  preview: { allowedHosts: true, host: true },
});
