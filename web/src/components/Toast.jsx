/**
 * Short-lived message at the bottom of the screen.
 *
 * Used by "neu einlesen": since the button now often decides to do
 * nothing (because the files are unchanged), the user needs to be told
 * that something happened at all. Without it, a no-op reload looks like
 * a broken button.
 *
 * @param {{ hint: { tone: 'info'|'success'|'error', text: string } | null }} props
 */
export function Toast({ hint }) {
  if (!hint) return null;
  return (
    <div className={`toast toast-${hint.tone}`} role="status" aria-live="polite">
      {hint.text}
    </div>
  );
}
