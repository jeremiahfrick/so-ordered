import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { clean, extractLineupBlock, parseLineup, renderSection, renderTable, trimBlock } from '../src/lineup';

const EXAMPLE_25_197 =
  'SOTOMAYOR, J., delivered the opinion of the Court, in which THOMAS, ALITO, KAVANAUGH, and JACKSON, JJ., joined. ' +
  'THOMAS, J., filed a concurring opinion. BARRETT, J., filed a dissenting opinion, in which ROBERTS, C. J., and ' +
  'KAGAN and GORSUCH, JJ., joined.';

const rows = (table: string) =>
  Object.fromEntries(
    table
      .split('\n')
      .slice(2)
      .map((r) => {
        const [name, ...cells] = r.split('|');
        return [name, cells];
      })
  );
const table = (text: string) => renderTable(parseLineup(text)!);

// These port tests/test_opinion_lineup.py from the old bot.
describe('parseLineup', () => {
  test('parses the majority writer and joiners', () => {
    const majority = parseLineup(EXAMPLE_25_197)!.entries.filter((e) => e.kind === 'majority');
    expect(majority).toHaveLength(1);
    expect(majority[0].writer).toBe('Sotomayor');
    expect(majority[0].joiners).toEqual(['Thomas', 'Alito', 'Kavanaugh', 'Jackson']);
  });

  test('parses a concurrence and a dissent', () => {
    const { entries } = parseLineup(EXAMPLE_25_197)!;
    const conc = entries.filter((e) => e.kind === 'concurrence');
    const diss = entries.filter((e) => e.kind === 'dissent');
    expect(conc[0].writer).toBe('Thomas');
    expect(conc[0].joiners).toEqual([]);
    expect(diss[0].writer).toBe('Barrett');
    expect(diss[0].joiners).toEqual(['Roberts', 'Kagan', 'Gorsuch']);
  });

  test('a clean block is recognized', () => expect(parseLineup(EXAMPLE_25_197)!.recognized).toBe(true));

  test('empty, missing and whitespace-only text give null', () => {
    for (const t of ['', null, undefined, '   ', '\n\t']) expect(parseLineup(t)).toBeNull();
  });

  test('a Chief Justice majority with a single joiner', () => {
    const e = parseLineup('ROBERTS, C. J., delivered the opinion of the Court, in which ALITO, J., joined.')!.entries[0];
    expect([e.kind, e.writer, e.joiners]).toEqual(['majority', 'Roberts', ['Alito']]);
  });

  test('concurring in the judgment is a concurrence', () => {
    const text = 'ALITO, J., delivered the opinion of the Court. KAGAN, J., filed an opinion concurring in the judgment.';
    expect(parseLineup(text)!.entries.filter((e) => e.kind === 'concurrence')[0].writer).toBe('Kagan');
  });

  test('a recusal is recorded and is not an entry', () => {
    const lineup = parseLineup(
      'ALITO, J., delivered the opinion of the Court. JACKSON, J., took no part in the consideration or decision of this case.'
    )!;
    expect(lineup.recusals).toEqual(['Jackson']);
    expect(lineup.entries.every((e) => e.writer !== 'Jackson')).toBe(true);
  });

  test('per curiam', () => {
    const lineup = parseLineup('PER CURIAM.')!;
    expect([lineup.perCuriam, lineup.recognized, lineup.entries]).toEqual([true, true, []]);
  });

  test('a plurality is not recognized and keeps only the paragraph', () => {
    const text =
      'GORSUCH, J., announced the judgment of the Court and delivered an opinion, in which ROBERTS, C. J., and THOMAS, J., joined.';
    const lineup = parseLineup(text)!;
    expect(lineup.recognized).toBe(false);
    expect(lineup.unrecognized).not.toEqual([]);
    const section = renderSection(text)!;
    expect(section).not.toContain('Judge|Majority');
    expect(section).toContain('announced the judgment');
  });

  test('a running page header injected mid-lineup is not the writer and does not reach the output', () => {
    const text =
      'GORSUCH, J., delivered the opinion of the Court, in which ROBERTS, C. J., and THOMAS, ALITO, KAVANAUGH, and BARRETT, JJ., joined. ' +
      '4 LANDOR v. LOUISIANA DEPT. OF CORRECTIONS AND PUBLIC SAFETY Syllabus JACKSON, J., filed a dissenting opinion, in which ' +
      'SOTOMAYOR and KAGAN, JJ., joined.';
    const lineup = parseLineup(text)!;
    const dissent = lineup.entries.find((e) => e.kind === 'dissent')!;
    expect(dissent.writer).toBe('Jackson');
    expect(dissent.joiners).toEqual(['Sotomayor', 'Kagan']);
    expect(rows(renderTable(lineup)).Jackson).toEqual(['', '', 'Writer']);
    expect(rows(renderTable(lineup)).Louisiana).toBeUndefined();
    const section = renderSection(text)!;
    expect(section).not.toContain('Louisiana');
    expect(section).not.toContain('Syllabus');
  });

  test('the "Page Proof Pending Publication" watermark mid-lineup does not break the joiner after it', () => {
    const entry = parseLineup('KAGAN, J., delivered the opinion of the Court, in which Page Proof Pending Publication ALITO, J., joined.')!
      .entries[0];
    expect([entry.writer, entry.joiners]).toEqual(['Kagan', ['Alito']]);
  });

  test.each([
    ['a soft hyphen', 'concur­\nring'],
    ['an ASCII hyphen before a newline', 'concur-\nring'],
  ])('a word wrapped with %s is rejoined', (_n, word) => {
    const kinds = parseLineup(`ALITO, J., delivered the opinion of the Court. THOMAS, J., filed a ${word} opinion.`)!.entries.map((e) => e.kind);
    expect(kinds).toContain('concurrence');
  });
});

describe('unanimous decisions', () => {
  const all = (t: string) => rows(table(t));

  test('"for a unanimous Court" fills all nine', () => {
    const r = all('ROBERTS, C. J., delivered the opinion for a unanimous Court.');
    expect(Object.keys(r)).toHaveLength(9);
    expect(r.Roberts).toEqual(['Writer', '', '']);
    for (const j of Object.keys(r).filter((j) => j !== 'Roberts')) expect(r[j]).toEqual(['Join', '', '']);
  });

  test('"in which all other Justices joined" fills all nine', () => {
    const r = all('KAGAN, J., delivered the opinion of the Court, in which all other Justices joined.');
    expect(Object.keys(r)).toHaveLength(9);
    expect(r.Kagan).toEqual(['Writer', '', '']);
  });

  test('a Justice who took no part is left out', () => {
    const r = all('ALITO, J., delivered the opinion for a unanimous Court. GORSUCH, J., took no part in the consideration or decision of this case.');
    expect(Object.keys(r)).toHaveLength(8);
    expect(r.Gorsuch).toBeUndefined();
    expect(r.Jackson).toEqual(['Join', '', '']);
  });
});

describe('renderTable', () => {
  test('marks the columns', () => {
    const t = table(EXAMPLE_25_197);
    const lines = t.split('\n');
    expect(lines.slice(0, 2)).toEqual(['Judge|Majority|Concurrence|Dissent', ':--|:--|:--|:--']);
    const r = rows(t);
    expect(r.Thomas).toEqual(['Join', 'Writer', '']); // joined the majority and wrote the concurrence
    expect(r.Sotomayor).toEqual(['Writer', '', '']);
    expect(r.Barrett).toEqual(['', '', 'Writer']);
    expect(r.Roberts).toEqual(['', '', 'Join']);
  });

  test('lists Justices in seniority order', () => {
    const names = table(EXAMPLE_25_197).split('\n').slice(2).map((r) => r.split('|')[0]);
    expect(names).toEqual(['Roberts', 'Thomas', 'Alito', 'Sotomayor', 'Kagan', 'Gorsuch', 'Kavanaugh', 'Barrett', 'Jackson']);
  });

  test('a partial concurrence/dissent marks both columns', () => {
    const r = rows(
      table('KAGAN, J., delivered the opinion of the Court. GORSUCH, J., filed an opinion concurring in part and dissenting in part, in which THOMAS, J., joined.')
    );
    expect(r.Gorsuch).toEqual(['', 'Writer', 'Writer']);
    expect(r.Thomas).toEqual(['', 'Join', 'Join']);
  });
});

describe('renderSection', () => {
  test('has the table and the verbatim paragraph', () => {
    const section = renderSection(EXAMPLE_25_197)!;
    expect(section).toContain('Judge|Majority|Concurrence|Dissent');
    expect(section).toContain('SOTOMAYOR, J., delivered the opinion of the Court');
    expect(section).toContain('BARRETT, J., filed a dissenting opinion');
  });

  test('starts and ends with a newline, so it follows the opinion table with the blank line Reddit needs', () => {
    const section = renderSection(EXAMPLE_25_197)!;
    expect(section.startsWith('\nJudge|')).toBe(true);
    expect(section.endsWith('.\n')).toBe(true);
  });

  test('null and empty give null', () => {
    expect(renderSection(null)).toBeNull();
    expect(renderSection('')).toBeNull();
  });

  test('Title-case mis-extraction gives null rather than junk', () => {
    expect(
      renderSection('Sotomayor, J., delivered the opinion for a unanimous Court. Michael L. Zuckerman, Deputy Solicitor General, argued the cause.')
    ).toBeNull();
  });
});

describe('text cleanup', () => {
  test('a real hyphen survives', () => expect(clean('Rooker-Feldman doctrine')).toBe('Rooker-Feldman doctrine'));

  test('trimBlock removes the trailing boilerplate', () => {
    expect(trimBlock('GORSUCH, J., delivered the opinion for a unanimous Court. _________________ 1 Cite as: 608 U. S. ____ (2026) NOTICE: ...')).toBe(
      'GORSUCH, J., delivered the opinion for a unanimous Court.'
    );
  });

  test('extractLineupBlock finds the syllabus form and ignores the body form', () => {
    const text = 'Syllabus text. GORSUCH, J., delivered the opinion of the Court. _________________ Cite as: 1 JUSTICE GORSUCH delivered the opinion.';
    expect(extractLineupBlock(text)).toBe('GORSUCH, J., delivered the opinion of the Court.');
    expect(extractLineupBlock('no lineup here')).toBeNull();
  });
});

// The same 40 slip opinions the old bot's PyMuPDF code was checked against. The text fixtures are the first 20,000
// characters of each PDF as unpdf extracts it; the golden files are what the old Python code (PyMuPDF) produced.
describe('40-opinion corpus, against the old bot', () => {
  const dir = join(__dirname, 'fixtures', 'lineups_text');
  const golden: Record<string, { block: string | null; section: string | null }> = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'lineups_golden.json'), 'utf8')
  );
  const names = readdirSync(dir).map((f) => f.replace(/\.txt$/, ''));

  test('covers every golden entry', () => expect(names.sort()).toEqual(Object.keys(golden).sort()));

  // In these three, unpdf and PyMuPDF differ only in the counsel text after the lineup (a "ﬁ" ligature that unpdf
  // normalizes to "fi", and an end-of-line hyphen unpdf keeps), and the lineup itself is unparseable small-caps
  // text that renders no section either way. What the post shows is the section, which is compared for all 40.
  const TRAILING_TEXT_DIFFERS = new Set(['607us2r13_m64n', '607us2r14_1a72', '607us2r18_d18f']);

  test.each(names)('%s', (name) => {
    const block = extractLineupBlock(readFileSync(join(dir, `${name}.txt`), 'utf8'));
    expect(renderSection(block)).toBe(golden[name].section);
    if (!TRAILING_TEXT_DIFFERS.has(name)) expect(block).toBe(golden[name].block);
  });
});
