<script setup>
/**
 * Was beim letzten Einlesen tatsächlich passiert ist.
 *
 * Der Zustand oben sagt „0 Aktionen", und das ist die halbe Auskunft. Die
 * andere Hälfte steht hier: welche Verzeichnisse gefunden wurden, welche
 * Basistabellen gelesen werden konnten und woran die übrigen gescheitert
 * sind. Ohne diese Karte führt jede leere Suche ins Server-Protokoll, und
 * da kommt niemand hin, der die Verwaltung bedient.
 */
import { computed, ref } from 'vue';
import { fmtNumber } from '../format.js';

const props = defineProps({ state: { type: Object, required: true } });

const read = computed(() => props.state.data.read);
const showTables = ref(false);

const dirs = computed(() => Object.entries(read.value ? read.value.dirs : {}));

const dirLabel = {
  ok: 'vorhanden und lesbar',
  missing: 'fehlt',
  unreadable: 'nicht lesbar',
};

const markOf = (status) => {
  if (status === 'ok') return { cls: 'ok', text: '✓' };
  if (status === 'missing') return { cls: 'soft', text: '!' };
  return { cls: 'bad', text: '✕' };
};

const problemMark = (level) => (level === 'error'
  ? { cls: 'bad', text: '✕' }
  : { cls: 'soft', text: '!' });

/** Sekunden sind hier die lesbarere Einheit, ein Lauf dauert Minuten. */
const duration = computed(() => {
  if (!read.value) return '–';
  const s = read.value.ms / 1000;
  return s < 1 ? `${read.value.ms} ms` : `${s.toFixed(1)} s`;
});
</script>

<template>
  <section class="card">
    <h2>Letzter Lesevorgang</h2>
    <p class="hint">
      Was der Server beim letzten Einlesen unter dem Datenpfad gefunden hat.
      Bleibt der Bestand leer, steht hier der Grund, ohne dass jemand ins
      Protokoll sehen muss.
    </p>

    <div v-if="!read" class="note warn">
      In diesem Lauf wurde noch nicht gelesen.
    </div>

    <template v-else>
      <div class="note" :class="read.ok ? 'ok' : 'bad'">{{ read.summary }}</div>

      <div class="facts" style="margin-top: 14px">
        <div class="fact">
          <div class="k">Datensätze</div>
          <div class="v mono">{{ fmtNumber(read.records) }}</div>
        </div>
        <div class="fact">
          <div class="k">Tabellen gelesen</div>
          <div class="v mono">{{ fmtNumber(read.files.read) }}</div>
        </div>
        <div class="fact">
          <div class="k">Fehlend</div>
          <div class="v mono">{{ fmtNumber(read.files.missing) }}</div>
        </div>
        <div class="fact">
          <div class="k">Fehlgeschlagen</div>
          <div class="v mono">{{ fmtNumber(read.files.failed) }}</div>
        </div>
        <div class="fact">
          <div class="k">Dauer</div>
          <div class="v mono">{{ duration }}</div>
        </div>
      </div>

      <ul class="checks">
        <li v-for="[name, info] in dirs" :key="name">
          <span class="mark" :class="markOf(info.status).cls">{{ markOf(info.status).text }}</span>
          <span class="name">{{ name }}/</span>
          <span class="detail">
            {{ dirLabel[info.status] }}<template v-if="info.status === 'ok'">, {{ fmtNumber(info.files) }} Einträge</template><template v-if="info.error"> ({{ info.error }})</template>
          </span>
        </li>
      </ul>

      <ul v-if="read.problems.length" class="checks">
        <li v-for="(problem, i) in read.problems.slice(0, 12)" :key="i">
          <span class="mark" :class="problemMark(problem.level).cls">{{ problemMark(problem.level).text }}</span>
          <span class="name">{{ problem.file }}</span>
          <span class="detail">{{ problem.detail }}<template v-if="problem.code"> ({{ problem.code }})</template></span>
        </li>
      </ul>
      <p v-if="read.problems.length > 12" class="hint" style="margin: 8px 0 0">
        und {{ read.problems.length - 12 }} weitere. Alle stehen im Protokoll
        des Dienstes.
      </p>

      <div class="row" style="margin-top: 14px">
        <button class="ghost" @click="showTables = !showTables">
          {{ showTables ? 'Tabellen ausblenden' : 'Alle Tabellen anzeigen' }}
        </button>
      </div>

      <ul v-if="showTables" class="checks">
        <li v-for="table in read.tables" :key="table.file">
          <span class="mark" :class="markOf(table.status).cls">{{ markOf(table.status).text }}</span>
          <span class="name">{{ table.file }}</span>
          <span class="detail">
            <template v-if="table.status === 'ok'">
              {{ fmtNumber(table.merged) }} Datensätze<template v-if="table.updates">, {{ table.updates }} Update-Dateien</template>
            </template>
            <template v-else-if="table.status === 'missing'">nicht vorhanden</template>
            <template v-else>{{ table.error }}</template>
          </span>
        </li>
      </ul>
    </template>
  </section>
</template>
