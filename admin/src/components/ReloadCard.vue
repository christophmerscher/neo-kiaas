<script setup>
/**
 * Neu einlesen.
 *
 * Der Knopf saß früher in der Fußzeile der Suche, wo ihn jeder ohne
 * Anmeldung sah. Hier ist er richtig aufgehoben. Die Regel dahinter
 * bleibt: gelesen wird nur, wenn sich die Dateien geändert haben.
 */
import { ref } from 'vue';
import { api } from '../api.js';
import { fmtDuration, fmtNumber } from '../format.js';

const props = defineProps({ state: { type: Object, required: true } });
const emit = defineEmits(['changed']);

const force = ref(false);
const busy = ref(false);
const result = ref(null);
const error = ref('');

const reasons = {
  unchanged: 'Keine Änderungen an den Daten.',
  changed: 'Die Dateien hatten sich geändert, es wurde neu eingelesen.',
  forced: 'Erzwungen neu eingelesen.',
  initial: 'Zum ersten Mal eingelesen.',
  'in-progress': 'Es lief bereits ein Einlesen; dessen Ergebnis gilt.',
};

async function run() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  result.value = null;
  try {
    const res = await api.reload(force.value);
    result.value = res;
    emit('changed');
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card">
    <h2>Neu einlesen</h2>
    <p class="hint">
      Der Server vergleicht zuerst Größe und Änderungsdatum aller Dateien.
      Stimmen sie mit dem letzten Stand überein, liest er nicht noch einmal.
      Das Lesen selbst dauert je nach Datenträger bis zu zwei Minuten.
    </p>

    <div class="row">
      <button class="primary" :disabled="busy || state.data.loading" @click="run">
        {{ busy || state.data.loading ? 'Liest ein…' : 'Jetzt einlesen' }}
      </button>
      <label class="row tight" style="text-transform: none; letter-spacing: 0; font-size: 13px; margin: 0; color: var(--fg-muted)">
        <input v-model="force" type="checkbox" :disabled="busy" />
        Erzwingen, auch ohne erkannte Änderung
      </label>
    </div>

    <div v-if="result" class="note" :class="result.reload.reloaded ? 'ok' : 'warn'">
      {{ reasons[result.reload.reason] || 'Fertig.' }}
      {{ fmtNumber(result.reload.files) }} Dateien geprüft
      ({{ fmtDuration(result.reload.checkMs) }}),
      Bestand: {{ fmtNumber(result.counts && result.counts.aktion) }} Aktionen.
    </div>
    <div v-if="error" class="note bad">{{ error }}</div>
  </section>
</template>
