import { OrderLink, orderDate } from './orders';
import { OrderEntry, ParsedOrder } from './orderParse';

export const MAX_BODY = 35_000;

// Court text is shown as written, but characters Reddit's markdown would act on are escaped, e.g. the
// "608 U. S. ___ (2026)" citations that would otherwise render as emphasis or a horizontal rule.
export function escapeMd(text: string): string {
  return text.replace(/[\\`*_|[\]^~]/g, '\\$&').replace(/^([#>+-])/, '\\$1');
}

export function isOrderList(link: OrderLink): boolean {
  const file = link.url.split('?')[0].split('/').pop() ?? '';
  return /order list/i.test(link.text) || /zor/i.test(file);
}

function entryLabel(parsed: ParsedOrder, e: OrderEntry): string {
  return parsed.layout === 'single' ? `No. ${e.docket}` : e.docket;
}

function linkLine(link: OrderLink): string {
  return `[${link.text || 'Order Document'}](${link.url})`;
}

// A miscellaneous order is short, so every entry is shown whole; nothing is truncated.
export function renderMiscOrder(link: OrderLink, now: Date, parsed: ParsedOrder): { title: string; body: string } | null {
  const date = orderDate(link, now);
  const entries = parsed.sections.flatMap((s) => s.entries);
  if (entries.length === 0) return null;

  const more = entries.length > 1 ? ` and ${entries.length - 1} more` : '';
  const title = `ORDERS: Miscellaneous Order — ${entries[0].docket}${more} (${date})`;

  const parts = [`Date: ${date}`];
  for (const section of parsed.sections) {
    if (section.header) parts.push(`**${escapeMd(section.header)}**`);
    for (const e of section.entries) {
      const label = entryLabel(parsed, e);
      parts.push(e.caption ? `**${label} — ${escapeMd(e.caption)}**` : `**${label}**`);
      if (e.text) parts.push(`> ${escapeMd(e.text)}`);
    }
  }
  parts.push(linkLine(link));

  const body = parts.join('\n\n');
  return body.length > MAX_BODY ? null : { title, body };
}

const MAX_ENTRIES = 25;
const MAX_ENTRY_TEXT = 600;

const isCountOnly = (header: string) => /DENIED\.?$/.test(header.trim());

// The Court prints consecutive docket lines followed by one shared order. In a detailed section every entry has a
// disposition, so a run of text-less entries shares the text of the entry that ends the run.
function groupShared(entries: OrderEntry[]): OrderEntry[] {
  const out: OrderEntry[] = [];
  let pending: OrderEntry[] = [];
  for (const e of entries) {
    if (e.text === '') {
      pending.push(e);
      continue;
    }
    const run = [...pending, e];
    out.push(
      run.length === 1
        ? e
        : {
            docket: run.map((x) => x.docket).join(', '),
            caption: run.map((x) => x.caption).filter(Boolean).join('; '),
            text: e.text,
          }
    );
    pending = [];
  }
  return [...out, ...pending]; // trailing text-less entries have nothing to share
}

function bullet(parsed: ParsedOrder, e: OrderEntry): string {
  const cut = e.text.length > MAX_ENTRY_TEXT ? `${e.text.slice(0, MAX_ENTRY_TEXT)}…` : e.text;
  const caption = e.caption ? ` — ${escapeMd(e.caption)}` : '';
  const text = cut ? `: ${escapeMd(cut)}` : '';
  return `- **${entryLabel(parsed, e)}**${caption}${text}`;
}

// An Order List: a counts table for every section, and the substantive sections (grants, summary dispositions,
// orders in pending cases, ...) listed in detail. Denials are only counted.
export function renderOrderList(link: OrderLink, now: Date, parsed: ParsedOrder): { title: string; body: string } | null {
  const date = orderDate(link, now);
  const title = ['ORDERS:', ...(link.text ? [link.text] : []), `(${date})`].join(' ');

  const parts = [`Date: ${date}`];
  const rows = parsed.sections.map((s) => `${escapeMd(s.header)}|${s.entries.length}`);
  parts.push(['Disposition|Count', ':--|:--', ...rows].join('\n'));

  for (const section of parsed.sections) {
    if (isCountOnly(section.header)) continue;
    parts.push(`**${escapeMd(section.header)}**`);
    const items = groupShared(section.entries);
    parts.push(items.slice(0, MAX_ENTRIES).map((e) => bullet(parsed, e)).join('\n'));
    if (items.length > MAX_ENTRIES) parts.push(`…and ${items.length - MAX_ENTRIES} more in the PDF`);
  }
  parts.push(linkLine(link));

  const body = parts.join('\n\n');
  return body.length > MAX_BODY ? null : { title, body };
}

export function renderOrder(link: OrderLink, now: Date, parsed: ParsedOrder): { title: string; body: string } | null {
  const total = parsed.sections.reduce((n, s) => n + s.entries.length, 0);
  return isOrderList(link) || total > 10 ? renderOrderList(link, now, parsed) : renderMiscOrder(link, now, parsed);
}
