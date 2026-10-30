import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OrderLink } from '../src/orders';
import { ParsedOrder, countDockets, parseOrderText } from '../src/orderParse';
import { MAX_BODY, escapeMd, isOrderList, renderMiscOrder, renderOrder, renderOrderList } from '../src/orderRender';

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

describe('renderOrderList', () => {
  const l = link('101926zor_q8l1.pdf', 'Order List');
  const parsed = parseOrderText(text('101926zor_q8l1'))!;
  const out = renderOrderList(l, now, parsed)!;

  test('the title is the unchanged simple title', () => {
    expect(out.title).toBe('ORDERS: Order List (10/19/2026)');
  });

  test('a counts table lists every section in the Court order', () => {
    expect(out.body).toContain(
      'Disposition|Count\n:--|:--\n' +
        'CERTIORARI -- SUMMARY DISPOSITION|1\n' +
        'ORDERS IN PENDING CASES|5\n' +
        'CERTIORARI GRANTED|2\n' +
        'CERTIORARI DENIED|74\n'
    );
  });

  test('grants, summary dispositions and pending-case orders are listed in detail', () => {
    expect(out.body).toContain('**CERTIORARI GRANTED**');
    expect(out.body).toContain("- **26-12** — ASS'N FOR ED. FAIRNESS V. MONTGOMERY CTY. BD. ED., ET AL.: The petition for a writ of certiorari is granted limited to the following question:");
    expect(out.body).toContain('- **26-204** — DEPT. OF JUSTICE, ET AL. V. SCOTT McNUTT, ET AL.: The petition for a writ of certiorari is granted.');
    expect(out.body).toContain('- **25-1269** — BURFORD GERMAN FUNDING, ET AL. V. FINANCIALRIGHT CLAIMS GMBH: ');
    expect(out.body).toContain('**ORDERS IN PENDING CASES**');
    expect(out.body).toContain('- **26-49** — ');
  });

  test('denials are counted but not listed', () => {
    expect(out.body).not.toContain('**CERTIORARI DENIED**');
    expect(out.body).not.toContain('25-1158');
  });

  test('ends with the PDF link', () => {
    expect(out.body.endsWith(`[Order List](${l.url})`)).toBe(true);
  });

  const synthetic = (entries: { docket: string; caption: string; text: string }[]): ParsedOrder => ({
    layout: 'list',
    dateLine: '',
    sections: [{ header: 'ORDERS IN PENDING CASES', entries }],
  });

  test('a detailed section shows at most 25 entries, then says how many more', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ docket: `26A${i + 1}`, caption: 'A V. B', text: 'Denied.' }));
    const o = renderOrderList(l, now, synthetic(entries))!;
    expect(o.body.match(/^- \*\*26A/gm)).toHaveLength(25);
    expect(o.body).toContain('\n…and 5 more in the PDF');
    expect(o.body).toContain('ORDERS IN PENDING CASES|30');
  });

  test('entry text over 600 characters is cut with an ellipsis', () => {
    const o = renderOrderList(l, now, synthetic([{ docket: '26A1', caption: 'A V. B', text: 'y'.repeat(900) }]))!;
    const bullet = o.body.split('\n').find((x) => x.startsWith('- **26A1**'))!;
    expect(bullet.endsWith('y'.repeat(600) + '…')).toBe(true);
    expect(bullet).not.toContain('y'.repeat(601));
  });

  test('court text in a bullet is markdown-escaped', () => {
    const o = renderOrderList(l, now, synthetic([{ docket: '26A1', caption: 'A V. B', text: 'See 608 U. S. ___ (2026).' }]))!;
    expect(o.body).toContain('See 608 U. S. \\_\\_\\_ (2026).');
  });

  test('a body over 35,000 characters is abandoned', () => {
    const sections = Array.from({ length: 12 }, (_, s) => ({
      header: `ORDERS IN PENDING CASES ${s}`,
      entries: Array.from({ length: 25 }, (_, i) => ({ docket: `26A${s}${i}`, caption: 'A V. B', text: 'z'.repeat(600) })),
    }));
    expect(renderOrderList(l, now, { layout: 'list', dateLine: '', sections })).toBeNull();
  });
});

describe('renderOrderList: grouped entries', () => {
  const l = link('101326zor_qol1.pdf', 'Order List');
  const out = renderOrderList(l, now, parseOrderText(text('101326zor_qol1'))!)!;

  test('the counts table has no row for a wrapped citation', () => {
    expect(out.body).not.toMatch(/^U\. S\. 371/m);
    expect(out.body).toContain('CERTIORARI -- SUMMARY DISPOSITIONS|4\n');
  });

  test("docket lines that share one order text are shown as one bullet, as the Court prints them", () => {
    expect(out.body).toContain(
      '- **26M23, 26M24** — ODOM, RACHEL B. V. OKLAHOMA; COUDRAIN, MARILYN, ET AL. V. BOEHRINGER INGELHEIM, ET AL.: ' +
        'The motions for leave to file petitions for writs of certiorari with the supplemental appendices under seal are granted.'
    );
    expect(out.body).toContain('- **25-1103, 25-1343** — U.S. DOGE SERVICE, ET AL. V. USDC DC, ET AL.; BLANCHE, ATT\'Y GEN. V. OZURUMBA, IZUCHUKWU: The petitions for writs of certiorari are granted.');
  });

  test('every docket in a detailed section appears in some bullet', () => {
    for (const d of ['26M23', '26M24', '25-159', '25-417', '25-7598', '26-5011', '26-5296', '25-1103']) {
      expect(out.body).toContain(d);
    }
  });
});

describe('renderOrderList: written opinions', () => {
  test('lists the opinions attached to the order list, before the PDF link', () => {
    const l = link('101326zor_qol1.pdf', 'Order List');
    const out = renderOrderList(l, now, parseOrderText(text('101326zor_qol1'))!)!;
    const heading = "**Written opinions with today's orders**";
    expect(out.body).toContain(
      `${heading}\n\n- **25-6989** — JESUS HERRERA-SALAZAR v. UNITED STATES: Justice Sotomayor, statement respecting the denial of certiorari`
    );
    expect(out.body.indexOf(heading)).toBeLessThan(out.body.indexOf(`[Order List](${l.url})`));
  });

  test('no heading when there are none', () => {
    const l = link('101926zor_q8l1.pdf', 'Order List');
    const parsed = parseOrderText(text('101926zor_q8l1'))!;
    parsed.opinions = undefined;
    expect(renderOrderList(l, now, parsed)!.body).not.toContain('Written opinions');
  });
});

describe('renderOrderList: counts', () => {
  test('a consolidated group of bare dockets is counted once per docket', () => {
    // 334 docket lines in the denied section of this list (6 of them are bare dockets in consolidated groups).
    const out = renderOrderList(link('011226zor_3d9g.pdf', 'Order List'), now, parseOrderText(text('011226zor_3d9g'))!)!;
    expect(out.body).toContain('CERTIORARI DENIED|334\n');
  });
});

describe('renderOrderList: the first order list of a Term', () => {
  test('is digested without a bogus section, within the size cap, and counts add up', () => {
    const parsed = parseOrderText(text('100526zor_2a34'))!;
    const out = renderOrder(link('100526zor_2a34.pdf', 'Order List'), now, parsed);
    expect(out).not.toBeNull();
    expect(out!.body.length).toBeLessThanOrEqual(MAX_BODY);
    expect(out!.body).not.toMatch(/\n25-\s/);
    expect(out!.body).toContain('CERTIORARI DENIED|');
    expect(out!.body).not.toContain('WILLIAMS, RONNARD'); // denials are counted, not listed
  });
});

describe('renderOrder', () => {
  test('an order list gets the digest, a one-entry miscellaneous order gets its text', () => {
    const list = renderOrder(link('101926zor_q8l1.pdf', 'Order List'), now, parseOrderText(text('101926zor_q8l1'))!)!;
    expect(list.body).toContain('Disposition|Count');
    const misc = renderOrder(link('102126zr_5i36.pdf', 'Miscellaneous Order'), now, parseOrderText(text('102126zr_5i36'))!)!;
    expect(misc.title).toBe('ORDERS: Miscellaneous Order — 26A416 (10/21/2026)');
  });

  test('a "miscellaneous" order with more than 10 entries is rendered as a digest', () => {
    const entries = Array.from({ length: 11 }, (_, i) => ({ docket: `26A${i + 1}`, caption: 'A V. B', text: 'Denied.' }));
    const big: ParsedOrder = { layout: 'list', dateLine: '', sections: [{ header: 'ORDERS IN PENDING CASES', entries }] };
    expect(renderOrder(link('102126zr_5i36.pdf', 'Miscellaneous Order'), now, big)!.body).toContain('Disposition|Count');
  });

  test('every historical order renders without throwing, within the size cap, with counts that add up', () => {
    const dir = join(__dirname, 'fixtures', 'orders_text');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt')).map((x) => x.replace(/\.txt$/, ''))) {
      const parsed = parseOrderText(text(f));
      if (!parsed) continue;
      const out = renderOrder(link(`${f}.pdf`, f.includes('zor') ? 'Order List' : 'Miscellaneous Order'), now, parsed);
      if (out === null) continue;
      expect(out.body.length).toBeLessThanOrEqual(MAX_BODY);
      if (out.body.includes('Disposition|Count')) {
        const rows = [...out.body.matchAll(/^(?!Disposition)([^\n|]+)\|(\d+)$/gm)].map((m) => Number(m[2]));
        expect(rows.reduce((a, b) => a + b, 0)).toBe(
          parsed.sections.reduce((n, s) => n + s.entries.reduce((m, e) => m + countDockets(e.docket), 0), 0)
        );
      }
    }
  });
});
