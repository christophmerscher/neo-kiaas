/** Anzeigehilfen. Deutsches Format, weil die Oberfläche deutsch ist. */

export const fmtNumber = (n) => (n ?? 0).toLocaleString('de-DE');

export function fmtDateTime(value) {
  if (!value) return '–';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function fmtDuration(ms) {
  if (!ms || ms < 1000) return `${ms || 0} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
