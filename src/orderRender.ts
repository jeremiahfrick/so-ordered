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
