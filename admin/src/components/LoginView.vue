<script setup>
/**
 * Anmeldung an der Verwaltung.
 *
 * Ein Benutzer, ein Passwort. Der Benutzername steht fest und ist
 * vorbelegt, damit niemand rät; das Feld bleibt trotzdem sichtbar, sonst
 * wirkt die Maske wie ein halber Login.
 */
import { ref } from 'vue';
import { api } from '../api.js';

const emit = defineEmits(['done']);

const user = ref('admin');
const password = ref('');
const busy = ref(false);
const error = ref('');

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api.login(user.value, password.value);
    emit('done');
  } catch (e) {
    error.value = e.message || 'Anmeldung fehlgeschlagen.';
  } finally {
    busy.value = false;
    password.value = '';
  }
}
</script>

<template>
  <div class="login">
    <div class="wordmark"><span class="accent">neo-KIAS</span> Verwaltung</div>
    <div class="sub">Datenpfad und Einlesen</div>

    <form class="card" @submit.prevent="submit">
      <div class="field">
        <label for="user">Benutzer</label>
        <input id="user" v-model="user" type="text" autocomplete="username" />
      </div>
      <div class="field">
        <label for="pw">Passwort</label>
        <input
          id="pw"
          v-model="password"
          type="password"
          autocomplete="current-password"
          autofocus
        />
      </div>
      <button class="primary" type="submit" :disabled="busy">
        {{ busy ? 'Prüfe…' : 'Anmelden' }}
      </button>
      <div v-if="error" class="note bad">{{ error }}</div>
    </form>

    <div class="footer">
      Inoffizielle Erweiterung, nicht von Ford. Ohne Gewähr.
    </div>
  </div>
</template>
