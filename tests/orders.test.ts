import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOrderPost, parseOrderLinks } from '../src/orders';

const html = readFileSync(join(__dirname, 'fixtures', 'orders.html'), 'utf8');

describe('parseOrderLinks', () => {
  const links = parseOrderLinks(html);

  test('matches only Order List / Miscellaneous Order links with .pdf hrefs', () => {
    expect(links).toHaveLength(12);
    expect(links.every((l) => l.url.toLowerCase().endsWith('.pdf'))).toBe(true);
    expect(links.some((l) => l.url.includes('notapdf'))).toBe(false);
    expect(links.some((l) => l.url.includes('unrelated'))).toBe(false);
  });

  test('keeps page order', () => {
    expect(links[0]).toEqual({
      id: 'https://www.supremecourt.gov/orders/courtorders/102126zr_5i36.pdf',
      url: 'https://www.supremecourt.gov/orders/courtorders/102126zr_5i36.pdf',
      text: 'Miscellaneous Order',
    });
  });

  test('resolves absolute, root-relative and relative hrefs', () => {
    const urls = links.map((l) => l.url);
    expect(urls).toContain('https://www.supremecourt.gov/orders/courtorders/100725zor_abcd.pdf');
    expect(urls).toContain('https://www.supremecourt.gov/orders/courtorders/102126zr_5i36.pdf');
    expect(urls).toContain('https://www.supremecourt.gov/orders/ordersofthecourt/courtorders/rel_wxyz.pdf');
  });

  test('duplicate href appears once', () => {
    expect(links.filter((l) => l.url.endsWith('102126zr_5i36.pdf'))).toHaveLength(1);
  });

  test('link text is whitespace-normalized', () => {
    expect(links.find((l) => l.url.endsWith('100725zor_abcd.pdf'))?.text).toBe('10/07/2025 Order List');
  });
});

describe('buildOrderPost', () => {
  // 02:30 UTC on 6 Oct is still the evening of 5 Oct at the Court (America/New_York).
  const now = new Date('2026-10-06T02:30:00Z');
  const url = 'https://www.supremecourt.gov/orders/courtorders/100725zor_abcd.pdf';
  const undated = 'https://www.supremecourt.gov/orders/courtorders/calendar.pdf';

  test('uses the date found in the link text', () => {
    expect(buildOrderPost({ id: url, url, text: '10/07/2025 Order List' }, now)).toEqual({
      title: 'ORDERS: 10/07/2025 Order List (10/07/2025)',
      body: `Date: 10/07/2025\n\n[10/07/2025 Order List](${url})`,
    });
  });

  test('a date in the link text wins over the date in the filename', () => {
    expect(buildOrderPost({ id: url, url, text: '10/08/2025 Order List' }, now).title).toBe(
      'ORDERS: 10/08/2025 Order List (10/08/2025)'
    );
  });

  test('reads the real date from the PDF filename (MMDDYY) when the text has none', () => {
    const u = 'https://www.supremecourt.gov/orders/courtorders/102126zr_5i36.pdf';
    expect(buildOrderPost({ id: u, url: u, text: 'Miscellaneous Order' }, now)).toEqual({
      title: 'ORDERS: Miscellaneous Order (10/21/2026)',
      body: `Date: 10/21/2026\n\n[Miscellaneous Order](${u})`,
    });
  });

  test('filename dates work for order lists and numbered miscellaneous orders', () => {
    const list = 'https://www.supremecourt.gov/orders/courtorders/101926zor_q8l1.pdf';
    const misc = 'https://www.supremecourt.gov/orders/courtorders/100726zr2_0813.pdf';
    expect(buildOrderPost({ id: list, url: list, text: 'Order List' }, now).title).toBe('ORDERS: Order List (10/19/2026)');
    expect(buildOrderPost({ id: misc, url: misc, text: 'Miscellaneous Order' }, now).title).toBe(
      'ORDERS: Miscellaneous Order (10/07/2026)'
    );
  });

  test('an impossible filename date (month 99) falls back to today', () => {
    const u = 'https://www.supremecourt.gov/orders/courtorders/991326zr_xxxx.pdf';
    expect(buildOrderPost({ id: u, url: u, text: 'Order List' }, now).title).toBe('ORDERS: Order List (10/05/2026)');
  });

  test('falls back to today as zero-padded MM/DD/YYYY when neither text nor filename has a date', () => {
    expect(buildOrderPost({ id: undated, url: undated, text: 'Order List' }, now)).toEqual({
      title: 'ORDERS: Order List (10/05/2026)',
      body: `Date: 10/05/2026\n\n[Order List](${undated})`,
    });
  });

  test('empty link text yields the generic body and a bare title', () => {
    expect(buildOrderPost({ id: undated, url: undated, text: '' }, now)).toEqual({
      title: 'ORDERS: (10/05/2026)',
      body: `Date: 10/05/2026\n\n[Order Document](${undated})`,
    });
  });
});
