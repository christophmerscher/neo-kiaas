import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Die angezeigte Fassung kommt aus der package.json im Wurzelverzeichnis,
// derselben Quelle wie /api/health und die Verwaltung. Früher stand sie als
// Konstante im Quelltext und blieb beim Erhöhen regelmäßig zurück.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

// Im Entwicklungsbetrieb reicht der Vite-Server /api weiter, genau wie es
// der Web-Dienst im Betrieb tut. Zeigt auf den lokalen Server; läuft die
// Schnittstelle woanders (etwa als rest-kias auf Port 5176), sagt man das
// über KIAS_API_URL.
const apiTarget = process.env.KIAS_API_URL || 'http://localhost:5175';

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
    },
  },
  build: { outDir: 'dist' },
});
