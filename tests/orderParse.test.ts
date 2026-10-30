import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseOrderText } from '../src/orderParse';

const text = (name: string) => readFileSync(join(__dirname, 'fixtures', 'orders_text', `${name}.txt`), 'utf8');

describe('parseOrderText: list layout', () => {
  test('a one-entry miscellaneous order', () => {
    const p = parseOrderText(text('102126zr_5i36'));
    expect(p).toEqual({
      layout: 'list',
      dateLine: 'WEDNESDAY, OCTOBER 21, 2026',
      sections: [
        {
          header: 'ORDER IN PENDING CASE',
          entries: [
            {
              docket: '26A416',
              caption: 'TRUMP, PRESIDENT OF U.S., ET AL. V. KINGDOM, ALISHEA S., ET AL.',
              text:
                'The application for stay presented to The Chief Justice and by him referred to the Court is denied. ' +
                'Justice Thomas and Justice Alito would grant the application for stay.',
            },
          ],
        },
      ],
    });
  });

  describe('an order list', () => {
    const p = parseOrderText(text('101926zor_q8l1'))!;
    const section = (header: string) => p.sections.find((s) => s.header === header)!;
    const dockets = (header: string) => section(header).entries.map((e) => e.docket);

    test('sections appear in the Court order', () => {
      expect(p.sections.map((s) => s.header)).toEqual([
        'CERTIORARI -- SUMMARY DISPOSITION',
        'ORDERS IN PENDING CASES',
        'CERTIORARI GRANTED',
        'CERTIORARI DENIED',
      ]);
    });

    test('pending cases and grants have the right dockets', () => {
      expect(dockets('ORDERS IN PENDING CASES')).toEqual(['26A237', '26A265', '26M27', '25-1391', '26-49']);
      expect(dockets('CERTIORARI GRANTED')).toEqual(['26-12', '26-204']);
      expect(dockets('CERTIORARI -- SUMMARY DISPOSITION')).toEqual(['25-1269']);
    });

    test('a grant keeps its question presented', () => {
      const grant = section('CERTIORARI GRANTED').entries[0];
      expect(grant.caption).toBe("ASS'N FOR ED. FAIRNESS V. MONTGOMERY CTY. BD. ED., ET AL.");
      expect(grant.text.startsWith('The petition for a writ of certiorari is granted limited to the following question:')).toBe(true);
    });

    test('the denied list is mostly bare entries, all counted', () => {
      const denied = section('CERTIORARI DENIED').entries;
      expect(denied).toHaveLength(74);
      expect(denied[0].docket).toBe('25-1158');
      expect(denied.filter((e) => e.text === '').length).toBeGreaterThanOrEqual(60);
    });

    test('a denial with a statement keeps its text', () => {
      const e = section('CERTIORARI DENIED').entries.find((x) => x.docket === '26-34')!;
      expect(e.caption).toBe("HANAWAY, ATT'Y GEN. MO., ET AL. V. SANDERSON, THOMAS");
      expect(e.text).toBe(
        'The petition for a writ of certiorari is denied. Justice Alito would grant the petition for a writ of certiorari.'
      );
    });

    test("the Court's brace marks on consolidated cases are not part of the caption or text", () => {
      const e = section('CERTIORARI DENIED').entries.find((x) => x.docket === '26-5443')!;
      expect(e.caption).toBe('TZUNUX-ZACARIAS, MARIO V. KENTUCKY');
      expect(e.text).toBe('');
    });

    test('wrapped citation lines inside an entry do not start a new entry', () => {
      const e = section('CERTIORARI -- SUMMARY DISPOSITION').entries[0];
      expect(e.text).toContain('Jules v. Andre Balazs Properties, 608 U. S. 200 (2026).');
      const quorum = section('ORDERS IN PENDING CASES').entries.find((x) => x.docket === '25-1391')!;
      expect(quorum.text).toContain('Justice Sotomayor, Justice Gorsuch, Justice Barrett, and Justice Jackson took no part');
    });

    test('page-number lines never appear in entry text', () => {
      const all = p.sections.flatMap((s) => s.entries.map((e) => e.text + ' ' + e.caption)).join(' ');
      expect(all).not.toMatch(/(^|\s)[12](\s|$)/);
    });

    test('appended opinions do not leak into any entry', () => {
      const all = JSON.stringify(p);
      expect(all).not.toContain('SUPREME COURT OF THE UNITED STATES');
      expect(all).not.toContain('ON PETITION FOR WRIT OF CERTIORARI');
    });
  });

  test('text that is not an order returns null', () => {
    expect(parseOrderText('hello')).toBeNull();
    expect(parseOrderText('')).toBeNull();
  });
});

describe('parseOrderText: wrapped citations', () => {
  test('a citation wrapped onto its own line is body text, not a section header', () => {
    const p = parseOrderText(text('101326zor_qol1'))!;
    expect(p.sections.map((s) => s.header)).not.toContain('U. S. 371 (2026).');
    const summary = p.sections.find((s) => s.header === 'CERTIORARI -- SUMMARY DISPOSITIONS')!;
    expect(summary.entries.map((e) => e.docket)).toEqual(['25-1367', '25-7569', '26-139', '26-5216']);
    expect(summary.entries[2].text.endsWith('Monsanto v. Durnell, 609 U. S. 371 (2026).')).toBe(true);
  });
});

describe('parseOrderText: single-Justice layout', () => {
  test('an administrative stay order', () => {
    const p = parseOrderText(text('050426zr1_f2bh'))!;
    expect(p.layout).toBe('single');
    expect(p.sections).toHaveLength(1);
    expect(p.sections[0].header).toBe('ORDER');
    const e = p.sections[0].entries[0];
    expect(e.docket).toBe('25A1208');
    expect(e.caption).toContain('GENBIOPRO, INC.');
    expect(e.caption).toContain('LOUISIANA, ET AL.');
    expect(e.text.startsWith('UPON CONSIDERATION of the application of counsel for the applicant,')).toBe(true);
    expect(e.text.endsWith('by 5 p.m. (EDT).')).toBe(true);
    expect(e.text).not.toContain('/s/');
  });
});

describe('corpus of historical orders', () => {
  const dir = join(__dirname, 'fixtures', 'orders_text');
  const files = readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => f.replace(/\.txt$/, ''));
  const strip = (s: string) => s.replace(/[\s,]+/g, ''); // commas too: consolidated dockets are joined with ", "

  // Independent restatement of what the parser should keep: everything after the date line and before
  // any appended opinions, minus page numbers and the Court's brace marks.
  function expectedConcat(raw: string): string {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const dateLine = lines[1];
    const out: string[] = [];
    let page = 1;
    for (const l of lines.slice(2)) {
      if (l === 'SUPREME COURT OF THE UNITED STATES') break;
      if (/^\d{1,3}$/.test(l) && Number(l) === page) {
        page++;
        continue;
      }
      if (l === dateLine || /^[)\]}]+$/.test(l)) continue;
      out.push(l.replace(/^(\d{2}-\d{1,5}|\d{2}[A-Z]\d{1,5}|[A-Z]-\d{1,5}|\d{1,3}, ORIG\.)\s+[)\]}]\s*/, '$1 '));
    }
    return strip(out.join(''));
  }

  test('every fixture parses without throwing, and at most 3 fall back to null', () => {
    const nulls: string[] = [];
    for (const f of files) {
      let p: ReturnType<typeof parseOrderText> = null;
      expect(() => {
        p = parseOrderText(text(f));
      }).not.toThrow();
      if (!p) nulls.push(f);
    }
    if (nulls.length > 3) throw new Error(`unparsed fixtures: ${nulls.join(', ')}`);
  });

  test('nothing is dropped, duplicated or reordered in list-layout orders', () => {
    const bad: string[] = [];
    for (const f of files) {
      const raw = text(f);
      const p = parseOrderText(raw);
      if (!p || p.layout !== 'list') continue;
      const parsed = strip(
        p.sections.map((s) => s.header + s.entries.map((e) => e.docket + e.caption + e.text).join('')).join('')
      );
      if (parsed !== expectedConcat(raw)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});
