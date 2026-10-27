import { RedisLike, isInitialized, isNoted, markNoted } from './dedup';
import { buildOpinionPost, parseAuthor, parseOpinionFeed, termYear } from './opinions';
import { buildOrderPost, parseOrderLinks } from './orders';

export type PollDeps = {
  fetchText: (url: string, headers?: Record<string, string>) => Promise<{ status: number; text: string }>;
  submit: (title: string, body: string) => Promise<void>; // throws on failure
  redis: RedisLike;
  log: (msg: string) => void;
  now: () => Date;
};

const BASE = 'https://www.supremecourt.gov';
const OPINIONS_FEED = `${BASE}/RSS/slipopinion_rss.aspx`;
const ORDERS_PAGE = `${BASE}/orders/ordersofthecourt/`;
const BROWSER_UA = { 'User-Agent': 'Mozilla/5.0' }; // the old bot sent a browser UA for the case JSON

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const HOUR_MS = 60 * 60 * 1000;

// True at most once per hour per key (state lives in Redis because each tick is a separate request).
async function oncePerHour(d: PollDeps, key: string): Promise<boolean> {
  const now = d.now().getTime();
  const last = Number(await d.redis.get(key));
  if (Number.isFinite(last) && last > 0 && now - last < HOUR_MS) return false;
  await d.redis.set(key, String(now));
  return true;
}

// The old bot's flow: find_and_post_opinions + post_it + find_and_post_orders. A key is marked noted only after
// submit resolves, so a failed post is retried on the next tick.
export async function runPoll(d: PollDeps): Promise<void> {
  if (!(await isInitialized(d.redis))) {
    if (await oncePerHour(d, 'last_uninitialized_warning')) {
      d.log('WARN not initialized: poll skipped (run "Initialize dedup" from the mod menu)');
    }
    return;
  }
  try {
    await pollOpinions(d);
  } catch (e) {
    d.log(`Exception (pollOpinions): ${message(e)}`);
  }
  try {
    await pollOrders(d);
  } catch (e) {
    d.log(`Exception (pollOrders): ${message(e)}`);
  }
  // Idle ticks are silent; this hourly line is the only sign of life (there is no external heartbeat).
  if (await oncePerHour(d, 'last_heartbeat')) d.log(`HEARTBEAT polling ok at ${d.now().toISOString()}`);
}

async function lookupAuthor(d: PollDeps, caseNum: string, caseJson: any): Promise<string> {
  try {
    const [m, day, y] = String(caseJson.sJsonCreationDate).split('/').map(Number);
    const ty = String(termYear(new Date(y, m - 1, day))).padStart(2, '0');
    const page = await d.fetchText(`${BASE}/opinions/slipopinion/${ty}`);
    if (page.status !== 200) throw new Error(`slip-opinion page status ${page.status}`);
    return parseAuthor(page.text, caseNum);
  } catch (e) {
    d.log(`Author lookup failed (${caseNum}): ${message(e)}`);
    return '';
  }
}

async function pollOpinions(d: PollDeps): Promise<void> {
  const feed = await d.fetchText(OPINIONS_FEED);
  if (feed.status !== 200) {
    d.log(`WARN opinions feed status ${feed.status}`);
    return;
  }
  const { opinions, skippedTitles } = parseOpinionFeed(feed.text);
  for (const t of skippedTitles) d.log(`No case ID found in entry: ${t}`);

  for (const opinion of opinions) {
    if (await isNoted(d.redis, 'cases', opinion.caseId)) continue;
    try {
      const res = await d.fetchText(`${BASE}/RSS/Cases/JSON/${opinion.caseNum}.json`, BROWSER_UA);
      if (res.status !== 200) {
        d.log(`Exception (post_it) case JSON status ${res.status} for ${opinion.caseNum}`);
        continue;
      }
      const caseJson = JSON.parse(res.text.replace(/^﻿/, ''));
      const author = await lookupAuthor(d, opinion.caseNum, caseJson);
      const { title, body } = buildOpinionPost(opinion, caseJson, author);
      await d.submit(title, body);
      await markNoted(d.redis, 'cases', opinion.caseId);
      d.log(`Posted opinion ${opinion.caseId}: ${title}`);
    } catch (e) {
      d.log(`Exception (post_it) ${opinion.caseId}: ${message(e)}`);
    }
  }
}

async function pollOrders(d: PollDeps): Promise<void> {
  const page = await d.fetchText(ORDERS_PAGE);
  if (page.status !== 200) {
    d.log(`WARN orders page status ${page.status}`);
    return;
  }
  const links = parseOrderLinks(page.text);
  if (links.length === 0) {
    d.log('WARN no order links found on orders page');
    return;
  }
  for (const link of links) {
    if (await isNoted(d.redis, 'orders', link.id)) continue;
    try {
      const { title, body } = buildOrderPost(link, d.now());
      await d.submit(title, body);
      await markNoted(d.redis, 'orders', link.id);
      d.log(`Posted order ${link.id}`);
    } catch (e) {
      d.log(`Exception (find_and_post_orders) ${link.id}: ${message(e)}`);
    }
  }
}
