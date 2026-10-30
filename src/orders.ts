import { parse } from 'node-html-parser';

export type OrderLink = { id: string; text: string; url: string };

const ORDERS_ROOT = 'https://www.supremecourt.gov';
const ORDERS_PAGE = `${ORDERS_ROOT}/orders/ordersofthecourt/`;
const DATE_IN_TEXT = /(\d{1,2}\/\d{1,2}\/\d{2,4})/;

function resolveHref(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('/')) return ORDERS_ROOT + href;
  return ORDERS_PAGE + href;
}

// Ports the link scan in find_and_post_orders. The PDF URL is the dedup id; the first occurrence of a URL wins.
export function parseOrderLinks(html: string): OrderLink[] {
  const seen = new Set<string>();
  const out: OrderLink[] = [];
  for (const a of parse(html).querySelectorAll('a')) {
    const text = a.text.trim().replace(/\s+/g, ' ');
    if (!text.includes('Order List') && !text.includes('Miscellaneous Order')) continue;
    const href = (a.getAttribute('href') ?? '').trim();
    if (!href || !href.toLowerCase().endsWith('.pdf')) continue;
    const url = resolveHref(href);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ id: url, url, text });
  }
  return out;
}

// "Today" is the Court's date: Devvit's clock is UTC, so late-evening orders would otherwise be dated tomorrow.
// Falls back to the UTC date if the runtime lacks time-zone data.
function mmddyyyy(d: Date): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
}

// Order PDFs are named MMDDYY + type, e.g. 102126zr_5i36.pdf (10/21/26) or 101926zor_q8l1.pdf (10/19/26).
function dateFromFilename(url: string): string | undefined {
  const basename = url.split('?')[0].split('/').pop() ?? '';
  const m = /^(\d{2})(\d{2})(\d{2})[a-z]/i.exec(basename);
  if (!m) return undefined;
  const [, mm, dd, yy] = m;
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return undefined;
  return `${mm}/${dd}/20${yy}`;
}

// Date precedence: a date in the link text (old behavior), then the date in the PDF filename, then today (Court time).
export function buildOrderPost(link: OrderLink, now: Date): { title: string; body: string } {
  const date = DATE_IN_TEXT.exec(link.text)?.[1] ?? dateFromFilename(link.url) ?? mmddyyyy(now);
  const title = ['ORDERS:', ...(link.text ? [link.text] : []), `(${date})`].join(' ');
  const body = [`Date: ${date}`, link.text ? `[${link.text}](${link.url})` : `[Order Document](${link.url})`].join('\n\n');
  return { title, body };
}
