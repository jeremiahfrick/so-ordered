// Ports opinion_lineup.py: parses the syllabus "lineup" paragraph of a Supreme Court slip opinion (who wrote
// and who joined the majority, concurrences and dissents) into a markdown table plus the verbatim sentences.
// Parsing and rendering work on plain text, so they need no PDF and no network.

// The Justices currently on the Court, in seniority order. This is the one roster maintained by hand:
//
//     UPDATE THIS LIST WHEN THE COURT CHANGES
//     (a Justice retires or dies, or a new Justice is confirmed).
//
// It both orders the table rows and fills in the joining Justices for a unanimous decision, whose syllabus names
// only the author ("delivered the opinion for a unanimous Court"). A stale list fills those tables with the wrong
// members. It reflects the present Court only; opinions from before 2022 would fill incorrectly.
export const CURRENT_COURT = ['Roberts', 'Thomas', 'Alito', 'Sotomayor', 'Kagan', 'Gorsuch', 'Kavanaugh', 'Barrett', 'Jackson'];

// Uppercase tokens that look like names but are role markers or connectors.
const NON_NAME = new Set(['JJ', 'CJ', 'THE', 'CHIEF', 'JUSTICE', 'JUSTICES', 'COURT', 'PART', 'PARTS', 'AND', 'PER', 'CURIAM', 'ALL']);

// ALL-CAPS surnames (small caps as the PDF text has them). Assumes simple surnames: a future Justice with an
// apostrophe or hyphen (e.g. "O'CONNOR") needs this pattern updated alongside CURRENT_COURT.
const nameTokens = (text: string) => text.match(/\b[A-Z][A-Z]+\b/g) ?? [];

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const names = (text: string) => nameTokens(text).filter((t) => !NON_NAME.has(t)).map(title);

// Names in an "in which ... joined" clause, or [] if there is none.
function joiners(sentence: string): string[] {
  const m = /in which (.+?) joined/.exec(sentence);
  return m ? names(m[1]) : [];
}

// The author is the surname right before ", J.," / ", C. J.," and the verb. That is sturdier than the first
// ALL-CAPS token, which can be a stray caption word from a running page header injected mid-lineup.
function writerOf(sentence: string): string | null {
  const m = /\b([A-Z][A-Za-z]+),\s+(?:C\.\s*J\.|J\.),\s+(?:delivered|filed|announced|took)/.exec(sentence);
  return m ? title(m[1]) : null;
}

// True if a sitting Justice's surname appears in ALL-CAPS. The syllabus sets Justice names in small caps, which
// the PDF text normally has as ALL-CAPS; their absence means the text is not a parseable lineup (an older PDF
// whose small caps came out as Title case, or body/counsel text that slipped past the anchor), so nothing is shown.
function hasKnownJustice(text: string): boolean {
  const upper = new Set(nameTokens(text));
  return CURRENT_COURT.some((j) => upper.has(j.toUpperCase()));
}

// A running page header: a page number, the case caption, then the section label. Matched on already-collapsed
// (single-spaced) text. Lineup sentences contain no bare page numbers, so this only targets injected headers.
const PAGE_HEADER = /\s\d+\s+[A-Z][A-Za-z0-9 .,'&-]*?\s(?:Syllabus|Opinion of the Court)\b/g;

// Normalizes PDF text: rejoins hyphenated line breaks (a soft hyphen, or a plain '-' directly before a newline, so
// real hyphens like "Rooker-Feldman" survive), drops the "Page Proof" watermark and collapses whitespace.
export function clean(text: string): string {
  return text
    .replace(/­\s*/g, '')
    .replace(/([\p{L}\p{N}_])-\s*\n\s*([\p{L}\p{N}_])/gu, '$1$2')
    .replace(/Page Proof Pending Publication/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Splits on a period that follows a lowercase letter and precedes an uppercase one ("...joined. THOMAS..."), so
// "C. J.," and "JJ.," are not split.
const splitSentences = (text: string) => text.split(/(?<=[a-z])\.\s+(?=[A-Z])/).filter((s) => s.trim() !== '');

type Kind = 'recusal' | 'per_curiam' | 'majority' | 'partial' | 'dissent' | 'concurrence';

function classify(sentence: string): Kind | null {
  const low = sentence.toLowerCase();
  if (low.includes('took no part')) return 'recusal';
  if (low.includes('per curiam')) return 'per_curiam';
  // Split and plurality opinions are deliberately not modeled: they get the paragraph only.
  if (low.includes('announced the judgment') || low.includes('with respect to part')) return null;
  if (low.includes('delivered the opinion')) return 'majority';
  if (low.includes('concurring in part and dissenting in part')) return 'partial';
  if (low.includes('dissent')) return 'dissent';
  if (low.includes('concurr')) return 'concurrence';
  return null;
}

// True if a majority sentence implies every other Justice joined ("for a unanimous Court", "in which all other
// Justices joined").
const isUnanimous = (sentence: string) => {
  const low = sentence.toLowerCase();
  return low.includes('unanimous') || low.includes('all other justices') || low.includes('all other members');
};

export type OpinionKind = 'majority' | 'concurrence' | 'dissent' | 'partial';
export type LineupEntry = { kind: OpinionKind; writer: string; joiners: string[]; fillCourt: boolean };
export type Lineup = {
  entries: LineupEntry[];
  recusals: string[];
  perCuriam: boolean;
  unrecognized: string[];
  raw: string;
  recognized: boolean;
};

export function parseLineup(text: string | null | undefined): Lineup | null {
  if (!text) return null;
  let cleaned = clean(text);
  if (!cleaned) return null;
  // Running page headers injected at page breaks are stripped here, on block-level text, not in clean() (which
  // also runs on the whole document, where a lazy match could span the lineup and remove the anchor).
  cleaned = cleaned.replace(PAGE_HEADER, ' ').replace(/\s+/g, ' ').trim();

  const lineup: Lineup = { entries: [], recusals: [], perCuriam: false, unrecognized: [], raw: cleaned, recognized: false };
  for (const sentence of splitSentences(cleaned)) {
    const kind = classify(sentence);
    if (kind === 'recusal') {
      const writer = writerOf(sentence);
      if (writer) lineup.recusals.push(writer);
      continue;
    }
    if (kind === 'per_curiam') {
      lineup.perCuriam = true;
      continue;
    }
    const writer = kind === null ? null : writerOf(sentence);
    if (kind === null || writer === null) {
      lineup.unrecognized.push(sentence.trim());
      continue;
    }
    lineup.entries.push({
      kind,
      writer,
      joiners: joiners(sentence),
      fillCourt: kind === 'majority' && isUnanimous(sentence),
    });
  }

  // Unanimous decisions name only the author, so those joiners become the rest of the current Court (minus the
  // author and anyone who took no part). Done after the loop so every recusal is known.
  for (const entry of lineup.entries) {
    if (entry.fillCourt) entry.joiners = CURRENT_COURT.filter((j) => j !== entry.writer && !lineup.recusals.includes(j));
  }
  lineup.recognized = lineup.unrecognized.length === 0 && (lineup.entries.length > 0 || lineup.perCuriam);
  return lineup;
}

const COLUMNS = ['Majority', 'Concurrence', 'Dissent'] as const;
type Column = (typeof COLUMNS)[number];

function kindColumns(kind: OpinionKind): Column[] {
  switch (kind) {
    case 'majority':
      return ['Majority'];
    case 'concurrence':
      return ['Concurrence'];
    case 'dissent':
      return ['Dissent'];
    case 'partial':
      return ['Concurrence', 'Dissent'];
  }
}

// Current Justices in seniority order, then anyone else alphabetically.
function seniorityCompare(a: string, b: string): number {
  const ia = CURRENT_COURT.indexOf(a);
  const ib = CURRENT_COURT.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Markdown table of who wrote or joined each opinion; '' if there are no entries.
export function renderTable(lineup: Lineup): string {
  const marks = new Map<string, Partial<Record<Column, 'Writer' | 'Join'>>>();
  const row = (name: string) => {
    if (!marks.has(name)) marks.set(name, {});
    return marks.get(name)!;
  };
  for (const entry of lineup.entries) {
    for (const col of kindColumns(entry.kind)) {
      row(entry.writer)[col] = 'Writer';
      for (const joiner of entry.joiners) {
        const r = row(joiner);
        if (r[col] === undefined) r[col] = 'Join'; // never downgrade a Writer to Join
      }
    }
  }
  if (marks.size === 0) return '';
  const lines = ['Judge|Majority|Concurrence|Dissent', ':--|:--|:--|:--'];
  for (const name of [...marks.keys()].sort(seniorityCompare)) {
    lines.push([name, ...COLUMNS.map((c) => marks.get(name)![c] ?? '')].join('|'));
  }
  return lines.join('\n');
}

// The verbatim lineup sentences, one per blank-line-separated block.
function paragraph(lineup: Lineup): string {
  return splitSentences(lineup.raw)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`))
    .join('\n\n');
}

// A post-ready lineup block (table + paragraph), or null if there is nothing usable. Degrades gracefully: empty
// -> null; every sentence understood -> table + paragraph; any sentence not understood -> paragraph only.
export function renderSection(text: string | null | undefined): string | null {
  const lineup = parseLineup(text);
  if (lineup === null) return null;
  // The paragraph-only tier is for real but unparsed lineups (an ALL-CAPS plurality). If nothing parsed AND no
  // sitting Justice appears in ALL-CAPS, the block is a mis-extraction or stray counsel text: show nothing.
  if (!lineup.recognized && !hasKnownJustice(lineup.raw)) return null;
  const parts: string[] = [];
  if (lineup.recognized) {
    const table = renderTable(lineup);
    if (table) parts.push(table, '');
  }
  const para = paragraph(lineup);
  if (para) parts.push(para);
  const body = parts.join('\n').trim();
  return body ? `\n${body}\n` : null;
}

// The syllabus form ("NAME, J., delivered/announced"), which is distinct from the opinion body form
// ("JUSTICE NAME delivered ...").
const ANCHOR = /[A-Z][A-Za-z]+,\s+(?:C\.\s*J\.|J\.),\s+(?:delivered|announced)/;

// The lineup is the last thing in the syllabus; these markers start the page separator or opinion body after it.
const BLOCK_END = /_{2,}|\bCite as:|\bNOTICE:|SUPREME COURT OF THE UNITED STATES|It is so ordered/;

export function trimBlock(text: string): string {
  const end = BLOCK_END.exec(text);
  return (end ? text.slice(0, end.index) : text).trim();
}

// The syllabus lineup block of a slip opinion's extracted text, or null.
export function extractLineupBlock(pdfText: string): string | null {
  const text = clean(pdfText);
  const match = ANCHOR.exec(text);
  if (!match) return null;
  return trimBlock(text.slice(match.index)) || null;
}
