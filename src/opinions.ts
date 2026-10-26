import { XMLParser } from 'fast-xml-parser';
import { parse } from 'node-html-parser';

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
    opinions.push({
      caseId,
      caseNum,
      summary: String(item.description ?? '').trim(),
      link: String(item.link ?? '').trim(),
    });
  }

  return { opinions, skippedTitles };
}

// Published by SCOTUS (scotusrss.py J_CODE_MAP); keep in sync if the court ever changes it.
export const J_CODE_MAP: Record<string, string> = {
  A: 'Justice Samuel A. Alito, Jr.',
  AB: 'Justice Amy Coney Barrett',
  BK: 'Justice Brett M. Kavanaugh',
  EK: 'Justice Elena Kagan',
  KJ: 'Justice Ketanji Brown Jackson',
  NG: 'Justice Neil M. Gorsuch',
  R: 'Chief Justice John G. Roberts, Jr.',
  SS: 'Justice Sonia Sotomayor',
  T: 'Justice Clarence Thomas',
  PC: 'Per Curiam',
  D: 'Decree in Original Case',
};

// Ports term_year_from_decision_date: the term starts in October.
export function termYear(decisionDate: Date): number {
  const year = decisionDate.getMonth() + 1 >= 10 ? decisionDate.getFullYear() : decisionDate.getFullYear() - 1;
  return year % 100;
}

const cellText = (el: { text: string }) => el.text.trim().replace(/\s+/g, ' ');

// Ports the table-reading half of fetch_principal_author. Like pandas' `next(...)` in the old bot, only the
// first table with a "Docket" column is searched.
export function parseAuthor(slipPageHtml: string, caseNum: string): string {
  for (const table of parse(slipPageHtml).querySelectorAll('table')) {
    const rows = table.querySelectorAll('tr');
    if (rows.length === 0) continue;
    const header = rows[0].querySelectorAll('th,td').map(cellText);
    const docketCol = header.indexOf('Docket');
    if (docketCol === -1) continue;
    const jCol = header.indexOf('J.');
    for (const row of rows.slice(1)) {
      const cells = row.querySelectorAll('td');
      if (cells[docketCol] && cellText(cells[docketCol]) === caseNum.trim() && jCol !== -1 && cells[jCol]) {
        const code = cellText(cells[jCol]);
        return J_CODE_MAP[code] ?? code;
      }
    }
    return '';
  }
  return '';
}

type Proceeding = { Text: string; Links?: { DocumentUrl: string }[] };

function proceedingLink(p: Proceeding): string | undefined {
  return p.Links ? `[${p.Text}](${p.Links[0].DocumentUrl})` : undefined;
}

// Ports get_table: the indentation-free layout and trailing newline are what Reddit's table parser needs.
function renderTable(head: string, cert: string, amicus: string, caseLink: string, summary: string, opinionLink: string, author: string): string {
  const amicusRow = amicus.length > 0 ? `Amicus|${amicus}\n` : '';
  return `\nCaption|${head}\n:--|:--\nSummary|${summary}\nAuthor|${author}\nOpinion|${opinionLink}\nCertiorari|${cert}\n${amicusRow}Case Link|${caseLink}\n`;
}

// Ports build_opinion_post (without the lineup section, which is v2).
export function buildOpinionPost(opinion: FeedOpinion, caseJson: any, authorName: string): { title: string; body: string } {
  const petitioner = String(caseJson.PetitionerTitle).split(', et al')[0];
  const head =
    'RespondentTitle' in caseJson ? `${petitioner} v. ${String(caseJson.RespondentTitle).split(', et al')[0]}` : petitioner;

  let cert = '';
  let amicus = '';
  for (const p of (caseJson.ProceedingsandOrder ?? []) as Proceeding[]) {
    if (['certiorari filed', 'certiorari before judgment filed'].some((s) => p.Text.includes(s))) {
      cert = proceedingLink(p) ?? cert;
    } else if (p.Text.includes('amicus curiae of United States')) {
      amicus = proceedingLink(p) ?? amicus;
    }
  }

  const caseUrl = `https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/${opinion.caseNum}.html`;
  const body = renderTable(head, cert, amicus, `[${opinion.caseNum}](${caseUrl})`, opinion.summary, opinion.link, authorName);
  return { title: `OPINION: ${head}`, body };
}
