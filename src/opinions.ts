import { XMLParser } from 'fast-xml-parser';

export type FeedOpinion = { caseId: string; caseNum: string; summary: string; link: string };

const CASE_ID = /\((\d{2}[-A]\d{1,4})\)/;

// Ports the entry loop of find_and_post_opinions in scotusrss.py.
export function parseOpinionFeed(xml: string): { opinions: FeedOpinion[]; skippedTitles: string[] } {
  const doc = new XMLParser({ ignoreAttributes: true }).parse(xml);
  const items: any[] = [].concat(doc?.rss?.channel?.item ?? []);
  const opinions: FeedOpinion[] = [];
  const skippedTitles: string[] = [];

  for (const item of items) {
    const title = String(item.title ?? '').trim(); // feedparser strips surrounding whitespace
    let caseId: string | null;
    let caseNum: string | null;

    if (!title.includes('Orig.')) {
      caseId = CASE_ID.exec(title)?.[1] ?? null;
      caseNum = caseId;
    } else {
      const open = title.indexOf('(');
      const close = title.indexOf(')');
      const comma = title.indexOf(',');
      if (open === -1 || close === -1 || comma === -1) {
        caseId = null;
        caseNum = null;
      } else {
        caseId = title.slice(open + 1, close);
        caseNum = '22O' + title.slice(open + 1, comma);
      }
    }

    if (caseId === null || caseNum === null) {
      skippedTitles.push(title);
      continue;
    }
    opinions.push({ caseId, caseNum, summary: String(item.description ?? '').trim(),
      link: String(item.link ?? '').trim(),
    });
  }

  return { opinions, skippedTitles };
}
