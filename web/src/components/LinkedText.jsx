import { REFERENCE_PATTERN, classifyRef } from '../utils/references';

/**
 * Wraps free text and turns recognised inline references (TSI 60/2010,
 * P2002, siehe Abbildung, …) into clickable links.
 *
 * Render decision per match:
 *   - doc ref + resolves to a different bulletin → blue link (→ open)
 *   - doc ref + resolves to the current bulletin → muted "self" pill
 *   - doc ref + doesn't resolve at all           → plain text
 *   - attachment ref + bulletin has forms        → 📎 link (open in new tab)
 *   - attachment ref + no forms                  → plain text
 *   - DTC code                                   → mono-font link (search)
 *   - anything we couldn't classify              → plain text
 *
 * Click routing happens in the parent via `onRefClick(refText, classifiedRef)`.
 *
 * @param {{
 *   text: string,
 *   onRefClick: (refText:string, classified:import('../utils/references').Ref) => void,
 *   hasForms?: boolean,
 *   refs?: Record<string, string|null>,
 *   currentCode?: string|null,
 * }} props
 */
export function LinkedText({ text, onRefClick, hasForms, refs, currentCode }) {
  if (text == null || text === '') return text;
  if (!onRefClick) return text;
  const str = typeof text === 'string' ? text : String(text);
  const resolved = refs || {};

  REFERENCE_PATTERN.lastIndex = 0;
  const out = [];
  let last = 0;
  let m;
  while ((m = REFERENCE_PATTERN.exec(str)) !== null) {
    if (m.index > last) out.push(str.slice(last, m.index));
    const ref = m[0];
    const classified = classifyRef(ref);

    // Attachment refs only make sense with an actual file to open.
    if (classified.kind === 'attachment' && !hasForms) {
      out.push(ref);
      last = m.index + ref.length;
      continue;
    }
    if (classified.kind === 'unknown') {
      out.push(ref);
      last = m.index + ref.length;
      continue;
    }

    // Doc refs use the server-resolved A_CODE to decide rendering.
    if (classified.kind === 'doc') {
      const hasResolution = Object.prototype.hasOwnProperty.call(resolved, ref);
      const target = hasResolution ? resolved[ref] : undefined;
      if (target == null) {
        // No target exists in the dataset — render as plain text.
        out.push(ref);
        last = m.index + ref.length;
        continue;
      }
      if (currentCode && target === currentCode) {
        // Self-reference — muted pill, not clickable.
        out.push(
          <span key={`ref-${m.index}`} className="text-ref-self" title="Verweist auf das aktuelle Bulletin">
            {ref}
          </span>
        );
        last = m.index + ref.length;
        continue;
      }
      // Bind the resolved code so the click handler can navigate directly.
      classified.resolvedCode = target;
    }

    out.push(
      <button
        key={`ref-${m.index}`}
        type="button"
        className={
          'text-ref text-ref-' + classified.kind +
          (classified.kind === 'attachment' ? ' is-form' : '')
        }
        onClick={() => onRefClick(ref, classified)}
        title={titleFor(classified)}
      >
        {ref}
      </button>
    );
    last = m.index + ref.length;
  }
  if (last < str.length) out.push(str.slice(last));
  return <>{out}</>;
}

function titleFor(classified) {
  switch (classified.kind) {
    case 'doc':        return `Bulletin ${classified.resolvedCode || classified.code} öffnen`;
    case 'attachment': return 'Anhang in neuem Tab öffnen';
    case 'dtc':        return `Aktionen zu DTC ${classified.code} suchen`;
    default:           return 'Verweis folgen';
  }
}
