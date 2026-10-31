import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { J_CODE_MAP, buildOpinionPost, parseAuthor, parseOpinionFeed, termYear } from '../src/opinions';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const caseJson = (name: string) => JSON.parse(fixture(name).replace(/^﻿/, ''));
const caseLink = (n: string) =>
  `[${n}](https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/${n}.html)`;

describe('parseOpinionFeed', () => {
  test('parses a normal item', () => {
    const { opinions } = parseOpinionFeed(fixture('opinions_rss.xml'));
    const brown = opinions.find((o) => o.caseId === '26A476');
    expect(brown).toEqual({
      caseId: '26A476',
      caseNum: '26A476',
      summary: expect.stringContaining('The Fourth Circuit’s mandamus order'),
      link: 'http://www.supremecourt.gov/opinions/26pdf/26a476_k537.pdf',
    });
  });

  test('single item feed returns one opinion', () => {
    const { opinions, skippedTitles } = parseOpinionFeed(fixture('opinions_rss_single.xml'));
    expect(opinions).toHaveLength(1);
    expect(opinions[0].caseId).toBe('26A476');
    expect(skippedTitles).toEqual([]);
  });

  test('empty feed returns none', () => {
    expect(parseOpinionFeed(fixture('opinions_rss_empty.xml'))).toEqual({ opinions: [], skippedTitles: [] });
  });

  test('original-jurisdiction item gets the 22O prefix', () => {
    const { opinions } = parseOpinionFeed(fixture('opinions_rss.xml'));
    const orig = opinions.find((o) => o.caseId === '141, Orig.');
    expect(orig?.caseNum).toBe('22O141');
    expect(orig?.link).toBe('http://www.supremecourt.gov/opinions/26pdf/141orig_abcd.pdf');
  });

  test('title without a case id is reported in skippedTitles and not returned', () => {
    const { opinions, skippedTitles } = parseOpinionFeed(fixture('opinions_rss.xml'));
    expect(skippedTitles).toEqual(['Mystery Matter - (per curiam)']);
    expect(opinions.map((o) => o.caseId)).toEqual(['26A476', '141, Orig.']);
  });
});

describe('termYear', () => {
  test('October starts a new term year', () => expect(termYear(new Date(2025, 9, 1))).toBe(25));
  test('September belongs to the previous term year', () => expect(termYear(new Date(2026, 8, 30))).toBe(25));
  test('January belongs to the previous term year', () => expect(termYear(new Date(2026, 0, 15))).toBe(25));
});

describe('parseAuthor', () => {
  const page = fixture('slipopinion_24.html');

  test('maps a justice code to the full name', () => {
    expect(parseAuthor(page, '24A884')).toBe('Justice Amy Coney Barrett');
    expect(J_CODE_MAP.PC).toBe('Per Curiam');
    expect(parseAuthor(page, '24-809')).toBe('Per Curiam');
  });

  test('finds a case listed in the second table of the page', () => {
    // 23-1187 (FDA v. R. J. Reynolds) is only in the second of the page's two opinion tables
    expect(parseAuthor(page, '23-1187')).toBe('Justice Amy Coney Barrett');
    expect(parseAuthor(page, '23-7483')).toBe('Justice Amy Coney Barrett');
  });

  test('keeps looking in later tables when an earlier one does not have the case', () => {
    const t = (docket: string, j: string) => `<table><tr><th>Docket</th><th>J.</th></tr><tr><td>${docket}</td><td>${j}</td></tr></table>`;
    expect(parseAuthor(t('1-1', 'T') + t('2-2', 'EK'), '2-2')).toBe('Justice Elena Kagan');
  });

  test('returns the raw code when it is unmapped', () => {
    const html = '<table><tr><th>Docket</th><th>J.</th></tr><tr><td>99-1</td><td>ZZ</td></tr></table>';
    expect(parseAuthor(html, '99-1')).toBe('ZZ');
  });

  test('returns empty string when the docket is absent', () => {
    expect(parseAuthor(page, '00-0000')).toBe('');
  });

  test('returns empty string when no table has a Docket column', () => {
    expect(parseAuthor('<p>maintenance</p>', '24-809')).toBe('');
  });
});

describe('buildOpinionPost', () => {
  const opinion = (caseNum: string) => ({ caseId: caseNum, caseNum, summary: 'S.', link: 'http://x/op.pdf' });

  test('with amicus: exact table, last cert/amicus match wins, et al stripped from petitioner', () => {
    const { title, body } = buildOpinionPost(opinion('23-1209'), caseJson('case_23-1209.json'), 'Justice Ketanji Brown Jackson');
    const head = 'M & K Employee Solutions, LLC v. Trustees of the IAM National Pension Fund';
    expect(title).toBe(`OPINION: ${head}`);
    expect(body).toBe(
      `\nCaption|${head}\n:--|:--\nSummary|S.\nAuthor|Justice Ketanji Brown Jackson\nOpinion|http://x/op.pdf\n` +
        `Certiorari|[Petition for a writ of certiorari filed. (Response due June 12, 2024)](https://www.supremecourt.gov/DocketPDF/23/23-1209/309455/20240509141333296_01%20Petition%20for%20Writ%20of%20Certiorari.pdf)\n` +
        `Amicus|[Brief amicus curiae of United States filed.](https://www.supremecourt.gov/DocketPDF/23/23-1209/380210/20251021155127873_23-1209_bsac_MKEmpSols.pdf)\n` +
        `Case Link|${caseLink('23-1209')}\n`
    );
  });

  test('without amicus: no Amicus line, everything else the same shape', () => {
    const { body } = buildOpinionPost(opinion('24-1056'), caseJson('case_24-1056.json'), 'Justice Neil M. Gorsuch');
    expect(body).toBe(
      `\nCaption|Isabel Rico, Petitioner v. United States\n:--|:--\nSummary|S.\nAuthor|Justice Neil M. Gorsuch\nOpinion|http://x/op.pdf\n` +
        `Certiorari|[Petition for a writ of certiorari filed. (Response due May 7, 2025)](https://www.supremecourt.gov/DocketPDF/24/24-1056/354707/20250403144021025_24-___%20Rico%20Pet.%204.3.25%20pdfA.pdf)\n` +
        `Case Link|${caseLink('24-1056')}\n`
    );
  });

  test('no RespondentTitle: head is the petitioner alone', () => {
    const { title } = buildOpinionPost(opinion('24-1056'), caseJson('case_no_respondent.json'), '');
    expect(title).toBe('OPINION: Isabel Rico, Petitioner');
  });

  test('et al stripped from respondent; missing cert leaves an empty cell; empty author stays empty', () => {
    const { title, body } = buildOpinionPost(opinion('24-109'), caseJson('case_24-109.json'), '');
    expect(title).toBe('OPINION: Louisiana, Appellant v. Phillip Callais');
    expect(body).toContain('\nAuthor|\n');
    expect(body).toContain(
      '\nCertiorari|\nAmicus|[Brief amicus curiae of United States in support of neither party  filed. VIDED.]('
    );
  });
});
