<script setup>
/**
 * Datenpfad ansehen, prüfen, speichern.
 *
 * Gespeichert wird erst nach einer bestandenen Prüfung. Sonst landet ein
 * Vertipper in der Datenbank, der Dienst startet beim nächsten Mal ins
 * Leere, und der Fehler sieht aus wie ein Defekt der Anwendung.
 */
import { computed, ref, watch } from 'vue';
import { api } from '../api.js';

const props = defineProps({ state: { type: Object, required: true } });
const emit = defineEmits(['changed']);

const path = ref(props.state.data.root);
const report = ref(null);
const testing = ref(false);
const saving = ref(false);
const error = ref('');
const saved = ref('');

// Wechselt der Pfad von außen (etwa nach dem Speichern), zieht das Feld nach.
watch(() => props.state.data.root, (next) => {
  if (!dirty.value) path.value = next;
});

/**
 * Pfade vergleichbar machen.
 *
 * Der Server antwortet mit dem aufgelösten Pfad, unter Windows also mit
 * Rückstrichen, während im Feld Schrägstriche stehen dürfen. Ohne diese
 * Angleichung hielte die Maske jede geprüfte Eingabe für nachträglich
 * geändert und ließe nie speichern.
 */
const norm = (p) => String(p || '').trim()
  .replace(/[\\/]+$/, '')
  .replace(/\\/g, '/')
  .toLowerCase();

const dirty = computed(() => norm(path.value) !== norm(props.state.data.root));
const canSave = computed(
  () => Boolean(report.value && report.value.ok && !saving.value
    && norm(report.value.root) === norm(path.value)),
);

/** Jede Änderung verwirft die alte Prüfung, sonst spricht sie über einen anderen Pfad. */
watch(path, () => { report.value = null; error.value = ''; saved.value = ''; });

async function test() {
  if (testing.value) return;
  testing.value = true;
  error.value = '';
  saved.value = '';
  try {
    report.value = await api.testPath(path.value);
  } catch (e) {
    error.value = e.message;
  } finally {
    testing.value = false;
  }
}

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  error.value = '';
  try {
    const res = await api.savePath(path.value, true);
    saved.value = res.reloading
      ? 'Gespeichert. Der Server liest die Daten jetzt neu ein.'
      : 'Gespeichert.';
    emit('changed');
  } catch (e) {
    error.value = e.message;
    if (e.data && e.data.report) report.value = e.data.report;
  } finally {
    saving.value = false;
  }
}

function markOf(check) {
  if (check.ok) return { cls: 'ok', text: '✓' };
  return check.required ? { cls: 'bad', text: '✕' } : { cls: 'soft', text: '!' };
}
</script>

<template>
  <section class="card">
    <h2>Datenpfad</h2>
    <p class="hint">
      Verzeichnis mit <code>Daten/</code>, <code>Update/</code> und
      <code>Formulare/</code>, <strong>aus Sicht des Servers</strong>. Im
      Container ist das der Ort, an den das Volume zeigt, meist
      <code>/data</code>, nicht der Laufwerksbuchstabe am Arbeitsplatz.
    </p>

    <div class="row">
      <div class="grow">
        <label for="root">Pfad</label>
        <input id="root" v-model="path" type="text" spellcheck="false" @keyup.enter="test" />
      </div>
    </div>

    <div class="row" style="margin-top: 14px">
      <button class="ghost" :disabled="testing" @click="test">
        {{ testing ? 'Prüfe…' : 'Zugriff testen' }}
      </button>
      <button class="primary" :disabled="!canSave" @click="save">
        {{ saving ? 'Speichere…' : 'Speichern und neu einlesen' }}
      </button>
      <span class="hint" style="margin: 0">
        Aktiv: <code>{{ state.data.root }}</code>&nbsp;
        <span class="pill" :class="state.data.source === 'db' ? 'ok' : 'warn'">
          {{ state.data.source === 'db' ? 'aus der Datenbank' : 'aus der .env' }}
        </span>
      </span>
    </div>

    <div v-if="report" class="note" :class="report.ok ? 'ok' : 'bad'">
      {{ report.summary }}
    </div>
    <ul v-if="report" class="checks">
      <li v-for="check in report.checks" :key="check.name">
        <span class="mark" :class="markOf(check).cls">{{ markOf(check).text }}</span>
        <span class="name">{{ check.name }}</span>
        <span class="detail">{{ check.detail }}</span>
      </li>
    </ul>

    <div v-if="error" class="note bad">{{ error }}</div>
    <div v-if="saved" class="note ok">{{ saved }}</div>
    <div v-else-if="report && report.ok && !canSave && dirty" class="note warn">
      Der Pfad wurde nach der Prüfung geändert. Bitte noch einmal testen.
    </div>
  </section>
</template>
