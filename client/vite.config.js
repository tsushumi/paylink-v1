import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Forward API calls to the Express server so the browser never hits CORS.
    proxy: { '/api': 'http://localhost:3000' },
    // Allow ngrok / tunnel hostnames when you share a payment link.
    allowedHosts: true,
  },
});
