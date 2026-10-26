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

const mmddyyyy = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

// Ports the title/body construction in find_and_post_orders; with no date in the text it uses today (old behavior).
export function buildOrderPost(link: OrderLink, now: Date): { title: string; body: string } {
  const date = DATE_IN_TEXT.exec(link.text)?.[1] ?? mmddyyyy(now);
  const title = ['ORDERS:', ...(link.text ? [link.text] : []), `(${date})`].join(' ');
  const body = [`Date: ${date}`, link.text ? `[${link.text}](${link.url})` : `[Order Document](${link.url})`].join('\n\n');
  return { title, body };
}
