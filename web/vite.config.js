import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Im Entwicklungsbetrieb reicht der Vite-Server /api weiter, genau wie es
// der Web-Dienst im Betrieb tut. Zeigt auf den lokalen Server; läuft die
// Schnittstelle woanders (etwa als rest-kias auf Port 5176), sagt man das
// über KIAS_API_URL.
const apiTarget = process.env.KIAS_API_URL || 'http://localhost:5175';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
    },
  },
  build: { outDir: 'dist' },
});
