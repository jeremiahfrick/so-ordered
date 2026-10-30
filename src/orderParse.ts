export type OrderEntry = { docket: string; caption: string; text: string };
export type OrderSection = { header: string; entries: OrderEntry[] };
export type ParsedOrder = { layout: 'list' | 'single'; dateLine: string; sections: OrderSection[] };

// Hyphen/letter forms only, so a wrapped citation such as "601 U. S. 1 (2023)" is never a docket line.
const DOCKET = /^(\d{2}-\d{1,5}|\d{2}[A-Z]\d{1,5}|\d{1,3}, ORIG\.)\s+(\S.*)$/;
const KNOWN_HEADER =
  /^(CERTIORARI|HABEAS CORPUS|MANDAMUS|PROHIBITION|REHEARINGS?|ORDERS? IN PENDING|ATTORNEY DISCIPLINE|APPEAL|DISMISSED|ORDER\b)/;
const ATTACHED_DOCS = 'SUPREME COURT OF THE UNITED STATES';

const isAllCaps = (l: string) => !/[a-z]/.test(l) && /[A-Z]/.test(l);

// Soft line wraps become single spaces; a trailing hyphen joins without a space.
function join(base: string, next: string): string {
  if (!base) return next;
  return base.endsWith('-') ? base + next : `${base} ${next}`;
}

function parseListLayout(lines: string[]): ParsedOrder | null {
  let i = lines.findIndex((l) => l.length > 0);
  if (i === -1 || !lines[i].startsWith('(ORDER LIST:')) return null;
  const dateLine = lines.slice(i + 1).find((l) => l.length > 0) ?? '';

  const sections: OrderSection[] = [];
  let section: OrderSection | undefined;
  let entry: OrderEntry | undefined;
  let inCaption = false;
  let nextPage = 1;

  const body = lines.slice(i + 1).filter((l) => l.length > 0);
  for (let k = 0; k < body.length; k++) {
    const line = body[k];
    if (line === ATTACHED_DOCS) break;
    if (/^\d{1,3}$/.test(line) && Number(line) === nextPage) {
      nextPage++;
      continue; // page-number line
    }
    if (line === dateLine) continue;
    if (/^[)\]}]+$/.test(line)) continue; // the Court's brace marks on consolidated cases

    const docket = DOCKET.exec(line);
    if (KNOWN_HEADER.test(line) && isAllCaps(line) && !docket) {
      section = { header: line, entries: [] };
      sections.push(section);
      entry = undefined;
      continue;
    }
    if (docket) {
      if (!section) {
        section = { header: '', entries: [] };
        sections.push(section);
      }
      entry = { docket: docket[1], caption: docket[2].replace(/^[)\]}]\s*/, ''), text: '' };
      section.entries.push(entry);
      inCaption = true;
      continue;
    }
    if (!entry) continue; // stray line before the first entry

    if (inCaption && (isAllCaps(line) || /^\(.*\)$/.test(line))) {
      entry.caption = join(entry.caption, line);
      continue;
    }
    inCaption = false;
    // An unknown all-caps header directly after body text and before a docket line starts a new section.
    if (entry.text && isAllCaps(line) && line.length > 3 && DOCKET.test(body[k + 1] ?? '')) {
      section = { header: line, entries: [] };
      sections.push(section);
      entry = undefined;
      continue;
    }
    entry.text = join(entry.text, line);
  }

  const kept = sections.filter((s) => s.entries.length > 0);
  return kept.length > 0 ? { layout: 'list', dateLine, sections: kept } : null;
}

export function parseOrderText(text: string): ParsedOrder | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  return parseListLayout(lines);
}
