import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Im Entwicklungsbetrieb reicht der Vite-Server /api weiter, genau wie es
// der Admin-Dienst im Betrieb tut. Zeigt auf den lokalen Server; läuft die
// Schnittstelle woanders (etwa als rest-kias auf Port 5176), sagt man das
// über KIAS_API_URL.
const apiTarget = process.env.KIAS_API_URL || 'http://localhost:5175';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    proxy: {
      // Anmeldung läuft über einen Keks, der Weiterleiter muss ihn
      // durchlassen: changeOrigin schreibt sonst die Herkunft um.
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  build: { outDir: 'dist' },
});
