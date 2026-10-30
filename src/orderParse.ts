export type OrderEntry = { docket: string; caption: string; text: string };
export type OrderSection = { header: string; entries: OrderEntry[] };
// A separate written opinion or statement appended to an Order List (only when its author and kind are certain).
export type OrderOpinion = { docket: string; caption: string; author: string; kind: string };
export type ParsedOrder = {
  layout: 'list' | 'single';
  dateLine: string;
  sections: OrderSection[];
  opinions?: OrderOpinion[];
};

// Hyphen/letter forms only, so a wrapped citation such as "601 U. S. 1 (2023)" is never a docket line.
// "D-3150" is an attorney-discipline docket.
const TOKEN = String.raw`\d{2}-\d{1,5}|\d{2}[A-Z]\d{1,5}|[A-Z]-\d{1,5}|\d{1,3}, ORIG\.`;
const DOCKET = new RegExp(`^(${TOKEN})\\s+(\\S.*)$`);

// How many dockets an entry covers: a consolidated group is stored as "24-109, 24-110".
export function countDockets(docket: string): number {
  return docket.match(new RegExp(TOKEN, 'g'))?.length ?? 0;
}
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

const AUTHOR_LINE = /^(?:Statement of |Opinion of )?(?:CHIEF JUSTICE|JUSTICE) [A-Z]+|^PER CURIAM\./;
// Only these kinds are emitted; anything else is dropped rather than guessed.
const KIND =
  /^(dissenting|concurring|concurring in the judgment|concurring in part and dissenting in part|dissenting from (?:the )?denial of .+|respecting (?:the )?denial of .+)$/;

const titleCase = (w: string) => w.charAt(0) + w.slice(1).toLowerCase();

// Each appended document starts "SUPREME COURT OF THE UNITED STATES / <caption> / ON ... / No. 25–6989. Decided ..."
// and then names its author, e.g. "JUSTICE SOTOMAYOR, with whom JUSTICE KAGAN joins, dissenting."
function parseOpinions(lines: string[]): OrderOpinion[] {
  const starts = lines.map((l, i) => (l === ATTACHED_DOCS ? i : -1)).filter((i) => i >= 0);
  const out: OrderOpinion[] = [];
  starts.forEach((s, k) => {
    const doc = lines.slice(s + 1, k + 1 < starts.length ? starts[k + 1] : lines.length);
    const noIdx = doc.findIndex((l) => /^Nos?\.\s/.test(l));
    if (noIdx < 0) return;
    const dm = /^Nos?\.\s+(\d{2}[–-]\d{1,5}|\d{2}[A-Z]\d{1,5}|\d{1,3}, Orig\.)/.exec(doc[noIdx]);
    if (!dm) return;
    const docket = dm[1].replace('–', '-').replace(', Orig.', ', ORIG.');
    const onIdx = doc.findIndex((l) => /^ON /.test(l));
    const caption = doc.slice(0, onIdx > 0 ? onIdx : 1).reduce((acc, x) => join(acc, x), '');

    let j = -1;
    for (let i = noIdx + 1; i < Math.min(doc.length, noIdx + 12); i++) {
      if (AUTHOR_LINE.test(doc[i])) {
        j = i;
        break;
      }
    }
    if (j < 0) return;
    let sentence = doc[j];
    for (let n = 1; !sentence.endsWith('.') && n <= 3 && j + n < doc.length; n++) sentence += ` ${doc[j + n]}`;
    sentence = sentence.replace(/([a-z])- ([a-z])/g, '$1$2').replace(/\s+/g, ' ').trim(); // "certio- rari"
    if (!sentence.endsWith('.')) return;

    if (sentence === 'PER CURIAM.') {
      out.push({ docket, caption, author: 'Per Curiam', kind: 'per curiam opinion' });
      return;
    }
    const m = /^(Statement of |Opinion of )?(CHIEF JUSTICE|JUSTICE) ([A-Z]+)(.*)\.$/.exec(sentence);
    if (!m) return;
    const rest = m[4]
      .replace(/^,\s*with whom .*?\bjoins?\b(?: except as to [^,]+)?/, '')
      .replace(/^[,\s]+/, '')
      .trim();
    if (!KIND.test(rest)) return;
    out.push({
      docket,
      caption,
      author: `${m[2] === 'CHIEF JUSTICE' ? 'Chief Justice' : 'Justice'} ${titleCase(m[3])}`,
      kind: m[1] === 'Statement of ' ? `statement ${rest}` : rest,
    });
  });
  return out;
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
  let attached: string[] = [];
  // Margin docket numbers for the current page (see the page-number branch below).
  let batch: string[] = [];

  const body = lines.slice(i + 1).filter((l) => l.length > 0);
  for (let k = 0; k < body.length; k++) {
    let line = body[k];
    // Appended opinions begin with a running head ("1Cite as: 607 U. S. ____ (2026)") before their own header, so
    // either marks the end of the listing; otherwise that head would be glued onto the last entry.
    if (line === ATTACHED_DOCS || /^\d*Cite as: /.test(line)) {
      attached = body.slice(k);
      break;
    }
    if (/^\d{1,3}$/.test(line) && Number(line) === nextPage) {
      nextPage++;
      // On the biggest lists the Court prints docket numbers that are multiples of 5 apart from their lines: the line
      // keeps "25- CAPTION" and the digits arrive as a batch of bare numbers right after the previous page's number.
      if (batch.length > 0) return null; // numbers nobody took: the pairing can't be trusted
      while (k + 1 < body.length && /^\d{4,5}$/.test(body[k + 1]) && Number(body[k + 1]) % 5 === 0) batch.push(body[++k]);
      continue; // page-number line
    }
    if (line === dateLine) continue;
    if (/^[)\]}]+$/.test(line)) continue; // the Court's brace marks on consolidated cases

    const truncated = /^(\d{2})-\s+(\S.*)$/.exec(line);
    if (truncated) {
      const n = batch.shift();
      if (n === undefined) return null; // can't restore the number: refuse rather than guess
      const prev = /^(\d{2})-(\d+)$/.exec(entry?.docket ?? '');
      if (prev && prev[1] === truncated[1] && Number(n) <= Number(prev[2])) return null; // out of order
      line = `${truncated[1]}-${n} ${truncated[2]}`;
    }

    // A docket number at the start of a wrapped line is a cross-reference when the line before ends "case No."
    // or when the rest of the line is ordinary lowercase prose (list captions are all caps).
    const afterCaseNo = /\bNos?\.$/.test(body[k - 1] ?? '');
    let docket = afterCaseNo ? null : DOCKET.exec(line);
    if (docket && /\b[a-z]{2,}\b/.test(docket[2])) docket = null;
    const bare = afterCaseNo ? null : BARE_DOCKET.exec(line);
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
      (DOCKET.test(nextLine) || BARE_DOCKET.test(nextLine) || /^\d{2}-\s+\S/.test(nextLine))
    ) {
      section = { header: line, entries: [] };
      sections.push(section);
      entry = undefined;
      continue;
    }
    entry.text = join(entry.text, line);
  }

  if (batch.length > 0) return null;
  const kept = sections.filter((s) => s.entries.length > 0);
  if (kept.length === 0) return null;
  const opinions = parseOpinions(attached);
  return { layout: 'list', dateLine, sections: kept, ...(opinions.length > 0 ? { opinions } : {}) };
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
