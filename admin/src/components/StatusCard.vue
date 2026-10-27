<script setup>
/**
 * Was der Server gerade tut.
 *
 * Der Fortschritt ist hier wichtiger als in der Suche: wer den Pfad
 * gerade umgestellt hat, will sehen, dass daraufhin etwas passiert.
 */
import { computed } from 'vue';
import { fmtDateTime, fmtNumber } from '../format.js';

const props = defineProps({ state: { type: Object, required: true } });

const data = computed(() => props.state.data);

const tone = computed(() => {
  if (data.value.loading) return 'warn';
  if (!data.value.looksLikeKias) return 'bad';
  if (data.value.readError) return 'warn';
  return data.value.loaded && data.value.bulletins > 0 ? 'ok' : 'warn';
});

const label = computed(() => {
  if (data.value.loading) return 'liest ein';
  if (!data.value.looksLikeKias) return 'kein Daten/ unter dem Pfad';
  if (!data.value.loaded) return 'nicht geladen';
  // Der Bestand steht, aber er ist eingefroren: das ist etwas anderes
  // als „bereit" und gehört in die Plakette, nicht nur in eine Zeile
  // weiter unten.
  if (data.value.readError) return 'Stand eingefroren';
  return data.value.bulletins > 0 ? 'bereit' : 'geladen, aber leer';
});

const percent = computed(() => {
  const p = data.value.progress;
  if (!p || !p.total) return 0;
  return Math.min(100, Math.round((p.current / p.total) * 100));
});
</script>

<template>
  <section class="card">
    <h2>Zustand</h2>
    <p class="hint">
      {{ state.serverName }} · Version {{ state.version }}
    </p>

    <div class="facts">
      <div class="fact">
        <div class="k">Server</div>
        <div class="v"><span class="pill" :class="tone">{{ label }}</span></div>
      </div>
      <div class="fact">
        <div class="k">Aktionen</div>
        <div class="v mono">{{ fmtNumber(data.bulletins) }}</div>
      </div>
      <div class="fact">
        <div class="k">Stand</div>
        <div class="v">{{ fmtDateTime(data.loadedAt) }}</div>
      </div>
      <div class="fact">
        <div class="k">Geprüfte Dateien</div>
        <div class="v mono">{{ data.fingerprint ? fmtNumber(data.fingerprint.files) : '–' }}</div>
      </div>
    </div>

    <template v-if="data.loading && data.progress">
      <div class="bar"><i :style="{ width: percent + '%' }"></i></div>
      <p class="hint" style="margin: 8px 0 0">
        {{ data.progress.name || data.progress.stage }} · {{ percent }} %
      </p>
    </template>

    <div v-if="data.readError" class="note warn">
      Der letzte Leseversuch ({{ fmtDateTime(data.readError.at) }}, ausgelöst von
      {{ data.readError.trigger }}) hat nichts gefunden und wurde verworfen.
      Angezeigt wird weiterhin der Stand von {{ fmtDateTime(data.readError.keptAt) }}.
      {{ data.readError.summary }}
    </div>

    <div v-if="state.settings.configured && !state.settings.ready" class="note warn">
      Die Einstellungsdatenbank antwortet nicht ({{ state.settings.error || 'unbekannt' }}).
      Der Pfad lässt sich ansehen, aber nicht speichern.
    </div>
    <div v-else-if="!state.settings.configured" class="note warn">
      Ohne Postgres gilt allein der Pfad aus der .env. Ein hier gesetzter Pfad
      ließe sich nicht speichern.
    </div>
  </section>
</template>
