/**
 * Wraps the first case-insensitive occurrence of `q` inside `text` in a
 * <strong>, leaving the rest as plain text. Used by result snippets to
 * draw attention to the matched term.
 *
 * @param {{ text?: string, q?: string }} props
 */
export function Highlight({ text, q }) {
  if (!q || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const idx = lower.indexOf(ql);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <strong>{text.slice(idx, idx + q.length)}</strong>
      {text.slice(idx + q.length)}
    </>
  );
}
