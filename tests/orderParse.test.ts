import { readFileSync } from 'node:fs';
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
