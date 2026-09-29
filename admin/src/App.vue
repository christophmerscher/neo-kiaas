<script setup>
/**
 * Verwaltung von neo-KIAS.
 *
 * Zwei Zustände: angemeldet oder nicht. Alles Weitere hängt am Zustand,
 * den `/api/admin/state` liefert; die Karten bekommen ihn als Eigenschaft
 * und melden zurück, wenn sich etwas geändert hat.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from './api.js';
import LoginView from './components/LoginView.vue';
import StatusCard from './components/StatusCard.vue';
import DataRootCard from './components/DataRootCard.vue';
import ReadReportCard from './components/ReadReportCard.vue';
import ReloadCard from './components/ReloadCard.vue';

/** null = noch unbekannt, dann zeigt die Seite nichts Halbes. */
const authenticated = ref(null);
const state = ref(null);
const error = ref('');

let timer = null;

/**
 * Zustand holen und den Takt nachziehen: während des Einlesens oft, sonst
 * selten. Ein Fortschrittsbalken, der alle fünfzehn Sekunden springt,
 * wäre keiner.
 */
async function refresh() {
  try {
    state.value = await api.state();
    authenticated.value = true;
    error.value = '';
  } catch (e) {
    if (e.status === 401) {
      authenticated.value = false;
      state.value = null;
    } else {
      error.value = e.message;
    }
  } finally {
    schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  if (authenticated.value === false) return;
  const busy = state.value && state.value.data && state.value.data.loading;
  timer = setTimeout(refresh, busy ? 2000 : 15000);
}

async function logout() {
  await api.logout().catch(() => {});
  authenticated.value = false;
  state.value = null;
  clearTimeout(timer);
}

onMounted(refresh);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <LoginView v-if="authenticated === false" @done="refresh" />

  <div v-else-if="state" class="shell">
    <header class="topbar">
      <div>
        <div class="wordmark"><span class="accent">neo-KIAS</span> Verwaltung</div>
        <div class="sub">angemeldet als admin · {{ state.serverName }}</div>
      </div>
      <div class="spacer"></div>
      <button class="link" @click="refresh">Aktualisieren</button>
      <button class="link" @click="logout">Abmelden</button>
    </header>

    <div v-if="state.defaultPassword" class="note warn" style="margin-bottom: 16px">
      Es gilt noch das voreingestellte Passwort. Für einen Server, den mehrere
      Personen erreichen, gehört <code>KIAS_ADMIN_PASSWORD</code> in die .env.
    </div>

    <div v-if="error" class="note bad" style="margin-bottom: 16px">{{ error }}</div>

    <StatusCard :state="state" />
    <DataRootCard :state="state" @changed="refresh" />
    <ReadReportCard :state="state" />
    <ReloadCard :state="state" @changed="refresh" />

    <div class="footer">
      Diese Seite ist nur für die Verwaltung. Die Suche läuft auf ihrem eigenen
      Port weiter. Inoffizielle Erweiterung, nicht von Ford. Ohne Gewähr.
    </div>
  </div>

  <div v-else class="login">
    <div class="wordmark"><span class="accent">neo-KIAS</span> Verwaltung</div>
    <div class="sub">{{ error || 'Einen Moment…' }}</div>
  </div>
</template>
