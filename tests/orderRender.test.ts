import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrderLink } from '../src/orders';
import { ParsedOrder, parseOrderText } from '../src/orderParse';
import { escapeMd, isOrderList, renderMiscOrder } from '../src/orderRender';

const text = (name: string) => readFileSync(join(__dirname, 'fixtures', 'orders_text', `${name}.txt`), 'utf8');
const base = 'https://www.supremecourt.gov/orders/courtorders/';
const link = (file: string, t: string): OrderLink => ({ id: base + file, url: base + file, text: t });
const now = new Date('2026-10-06T02:30:00Z');

describe('escapeMd', () => {
  test('escapes underscores so "___" cannot become a rule or emphasis', () => {
    expect(escapeMd('608 U. S. ___ (2026)')).toBe('608 U. S. \\_\\_\\_ (2026)');
  });
  test('escapes pipes, asterisks, backticks, brackets, carets and tildes', () => {
    expect(escapeMd('a|b *c* `d` [e] ^f ~g')).toBe('a\\|b \\*c\\* \\`d\\` \\[e\\] \\^f \\~g');
  });
  test('escapes a leading #, >, - or +', () => {
    expect(escapeMd('# x')).toBe('\\# x');
    expect(escapeMd('> x')).toBe('\\> x');
    expect(escapeMd('- x')).toBe('\\- x');
    expect(escapeMd('+ x')).toBe('\\+ x');
  });
  test('leaves ordinary court text alone', () => {
    const s = "The petition for a writ of certiorari is granted. ATT'Y GEN. v. U. S. C. §2109 (1992)";
    expect(escapeMd(s)).toBe(s);
  });
});

describe('isOrderList', () => {
  test('by link text', () => expect(isOrderList(link('x.pdf', 'Order List'))).toBe(true));
  test('by "zor" in the filename', () => expect(isOrderList(link('101926zor_q8l1.pdf', 'Miscellaneous Order'))).toBe(true));
  test('a miscellaneous order is not an order list', () =>
    expect(isOrderList(link('102126zr_5i36.pdf', 'Miscellaneous Order'))).toBe(false));
});

describe('renderMiscOrder', () => {
  test('a one-entry order shows the order text', () => {
    const l = link('102126zr_5i36.pdf', 'Miscellaneous Order');
    const out = renderMiscOrder(l, now, parseOrderText(text('102126zr_5i36'))!);
    expect(out).toEqual({
      title: 'ORDERS: Miscellaneous Order — 26A416 (10/21/2026)',
      body:
        'Date: 10/21/2026\n\n**ORDER IN PENDING CASE**\n\n' +
        '**26A416 — TRUMP, PRESIDENT OF U.S., ET AL. V. KINGDOM, ALISHEA S., ET AL.**\n\n' +
        '> The application for stay presented to The Chief Justice and by him referred to the Court is denied. ' +
        'Justice Thomas and Justice Alito would grant the application for stay.\n\n' +
        `[Miscellaneous Order](${l.url})`,
    });
  });

  test('a denied stay of execution keeps its denial header and text', () => {
    const out = renderMiscOrder(link('102026zr_2d9g.pdf', 'Miscellaneous Order'), now, parseOrderText(text('102026zr_2d9g'))!)!;
    expect(out.body).toContain('**CERTIORARI DENIED**');
    expect(out.body).toContain('**26-5865 — REAVES, WILLIAM v. FLORIDA, ET AL. (26A524)**');
    expect(out.body).toContain('> The application for stay of execution of sentence of death presented to Justice Thomas');
  });

  test('several entries: title counts the rest, each section and entry is shown', () => {
    const out = renderMiscOrder(link('120525zr_hejm.pdf', 'Miscellaneous Order'), now, parseOrderText(text('120525zr_hejm'))!)!;
    expect(out.title).toBe('ORDERS: Miscellaneous Order — 24-621 and 4 more (12/05/2025)');
    expect(out.body).toContain('**ORDER IN PENDING CASE**');
    expect(out.body).toContain('**CERTIORARI GRANTED**');
    for (const d of ['24-621', '25-83', '25-197', '25-365', '25-5146']) expect(out.body).toContain(`**${d} — `);
  });

  test('a single-Justice order uses "No." for its docket', () => {
    const out = renderMiscOrder(link('050426zr1_f2bh.pdf', 'Miscellaneous Order'), now, parseOrderText(text('050426zr1_f2bh'))!)!;
    expect(out.title).toBe('ORDERS: Miscellaneous Order — 25A1208 (05/04/2026)');
    expect(out.body).toContain('**ORDER**');
    expect(out.body).toContain('**No. 25A1208 — GENBIOPRO, INC., Applicant v. LOUISIANA, ET AL.**');
  });

  test('court text is markdown-escaped', () => {
    const parsed: ParsedOrder = {
      layout: 'list',
      dateLine: '',
      sections: [{ header: 'ORDER IN PENDING CASE', entries: [{ docket: '26A1', caption: 'A V. B', text: 'See 608 U. S. ___ (2026).' }] }],
    };
    expect(renderMiscOrder(link('102126zr_5i36.pdf', 'Miscellaneous Order'), now, parsed)!.body).toContain(
      '> See 608 U. S. \\_\\_\\_ (2026).'
    );
  });

  test('a long order is not truncated, but a body over 35,000 characters is abandoned', () => {
    const entry = (n: number) => ({ docket: `26A${n}`, caption: 'A V. B', text: 'x'.repeat(5000) });
    const mk = (n: number): ParsedOrder => ({
      layout: 'list',
      dateLine: '',
      sections: [{ header: 'ORDER IN PENDING CASE', entries: Array.from({ length: n }, (_, i) => entry(i + 1)) }],
    });
    const l = link('102126zr_5i36.pdf', 'Miscellaneous Order');
    expect(renderMiscOrder(l, now, mk(1))!.body).toContain('x'.repeat(5000));
    expect(renderMiscOrder(l, now, mk(8))).toBeNull();
  });
});
