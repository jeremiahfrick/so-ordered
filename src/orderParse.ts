export type OrderEntry = { docket: string; caption: string; text: string };
export type OrderSection = { header: string; entries: OrderEntry[] };
export type ParsedOrder = { layout: 'list' | 'single'; dateLine: string; sections: OrderSection[] };

// Hyphen/letter forms only, so a wrapped citation such as "601 U. S. 1 (2023)" is never a docket line.
// "D-3150" is an attorney-discipline docket.
const TOKEN = String.raw`\d{2}-\d{1,5}|\d{2}[A-Z]\d{1,5}|[A-Z]-\d{1,5}|\d{1,3}, ORIG\.`;
const DOCKET = new RegExp(`^(${TOKEN})\\s+(\\S.*)$`);
// Consolidated cases list several bare dockets, then brace marks, then one shared caption.
const BARE_DOCKET = new RegExp(`^(${TOKEN})$`);
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
    const bare = BARE_DOCKET.exec(line);
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
    if (bare) {
      if (section && entry && inCaption && !entry.caption && !entry.text) {
        entry.docket += `, ${bare[1]}`; // another docket in the same consolidated group
      } else {
        if (!section) {
          section = { header: '', entries: [] };
          sections.push(section);
        }
        entry = { docket: bare[1], caption: '', text: '' };
        section.entries.push(entry);
        inCaption = true;
      }
      continue;
    }
    if (!entry) continue; // stray line before the first entry

    if (inCaption && (isAllCaps(line) || /^\(.*\)$/.test(line))) {
      entry.caption = join(entry.caption, line);
      continue;
    }
    inCaption = false;
    // An unknown all-caps header directly after body text and before a docket line starts a new section.
    // (A wrapped citation tail like "U. S. 371 (2026)." is all caps too, so a real header needs a word of 4+ capitals
    // and must not end like a sentence.)
    const nextLine = body[k + 1] ?? '';
    if (
      entry.text &&
      isAllCaps(line) &&
      /[A-Z]{4,}/.test(line) &&
      !/[.)]$/.test(line) &&
      (DOCKET.test(nextLine) || BARE_DOCKET.test(nextLine))
    ) {
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

// "Supreme Court of the United States / No. 25A1207 / <parties> / O R D E R / <text> / /s/ <Justice> / Dated ..."
function parseSingleLayout(lines: string[]): ParsedOrder | null {
  const l = lines.filter((x) => x.length > 0);
  if (l.length < 4 || l[0].toLowerCase() !== 'supreme court of the united states') return null;
  const no = /^Nos?\.\s+(\S+)/.exec(l[1]);
  const orderAt = l.findIndex((x) => /^O\s?R\s?D\s?E\s?R$/.test(x));
  if (!no || orderAt < 2) return null;

  const caption = l.slice(2, orderAt).reduce((acc, x) => join(acc, x), '');
  let text = '';
  let page = 1;
  let i = orderAt + 1;
  for (; i < l.length && !l[i].startsWith('/s/'); i++) {
    if (/^\d{1,3}$/.test(l[i]) && Number(l[i]) === page) {
      page++;
      continue;
    }
    text = join(text, l[i]);
  }
  if (!text) return null;
  const dated = l.findIndex((x, k) => k > i && /^Dated\b/.test(x));
  const dateLine = dated === -1 ? '' : l.slice(dated).reduce((acc, x) => join(acc, x), '');
  return {
    layout: 'single',
    dateLine,
    sections: [{ header: 'ORDER', entries: [{ docket: no[1], caption, text }] }],
  };
}

export function parseOrderText(text: string): ParsedOrder | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  return parseListLayout(lines) ?? parseSingleLayout(lines);
}
