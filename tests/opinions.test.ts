import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseOpinionFeed } from '../src/opinions';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

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
