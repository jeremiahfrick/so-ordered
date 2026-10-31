import { RedisLike, initialize, isInitialized, isNoted, markNoted } from './dedup';
import { buildOpinionPost, parseAuthor, parseOpinionFeed, termYear } from './opinions';
import { OrderLink, buildOrderPost, parseOrderLinks } from './orders';
import { parseOrderText } from './orderParse';
import { renderOrder } from './orderRender';

export type PollDeps = {
  fetchText: (url: string, headers?: Record<string, string>) => Promise<{ status: number; text: string }>;
  fetchBytes: (url: string) => Promise<{ status: number; bytes: Uint8Array }>;
  pdfText: (bytes: Uint8Array) => Promise<string>;
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

async function fetchFeed(d: PollDeps, warn: (m: string) => void) {
  const feed = await d.fetchText(OPINIONS_FEED);
  if (feed.status !== 200) {
    warn(`WARN opinions feed status ${feed.status}`);
    return null;
  }
  return parseOpinionFeed(feed.text);
}

async function fetchOrderLinks(d: PollDeps, warn: (m: string) => void) {
  const page = await d.fetchText(ORDERS_PAGE);
  if (page.status !== 200) {
    warn(`WARN orders page status ${page.status}`);
    return null;
  }
  const links = parseOrderLinks(page.text);
  if (links.length === 0) {
    warn('WARN no order links found on orders page');
    return null;
  }
  return links;
}

// First run after install: everything already on the Court's site counts as seen and nothing is posted, so a
// subreddit only gets documents published from now on. Nothing is recorded unless both listings were read, so a
// Court outage just delays the start (retried every tick, warning at most hourly).
async function baseline(d: PollDeps): Promise<void> {
  const warn = async (m: string) => {
    if (await oncePerHour(d, 'last_uninitialized_warning')) d.log(m);
  };
  const pending: string[] = [];
  const quiet = (m: string) => void pending.push(m);
  const feed = await fetchFeed(d, quiet);
  const links = feed ? await fetchOrderLinks(d, quiet) : null;
  if (!feed || !links) {
    for (const m of pending) await warn(m);
    return;
  }
  await initialize(d.redis, { cases: feed.opinions.map((o) => o.caseId), orders: links.map((l) => l.id) });
  const n = feed.opinions.length;
  d.log(
    `Initialized: skipped ${n} ${n === 1 ? 'opinion' : 'opinions'} and ${links.length} ${links.length === 1 ? 'order' : 'orders'} ` +
      "already on the Court's site; posting new ones from now on"
  );
}

// The old bot's flow: find_and_post_opinions + post_it + find_and_post_orders. A key is marked noted only after
// submit resolves, so a failed post is retried on the next tick.
export async function runPoll(d: PollDeps): Promise<void> {
  if (!(await isInitialized(d.redis))) {
    await baseline(d);
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
  const feed = await fetchFeed(d, d.log);
  if (!feed) return;
  const { opinions, skippedTitles } = feed;
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

// The digest is a bonus: any failure logs one warning and falls back to the simple link post.
async function buildOrderPostWithDigest(
  d: PollDeps,
  link: OrderLink
): Promise<{ post: { title: string; body: string }; digest: boolean }> {
  try {
    const res = await d.fetchBytes(link.url);
    if (res.status !== 200) throw new Error(`PDF status ${res.status}`);
    const parsed = parseOrderText(await d.pdfText(res.bytes));
    if (!parsed) throw new Error('unrecognized layout');
    const post = renderOrder(link, d.now(), parsed);
    if (!post) throw new Error('digest too long');
    return { post, digest: true };
  } catch (e) {
    d.log(`WARN orders digest failed for ${link.url}: ${message(e)}`);
    return { post: buildOrderPost(link, d.now()), digest: false };
  }
}

async function pollOrders(d: PollDeps): Promise<void> {
  const links = await fetchOrderLinks(d, d.log);
  if (!links) return;
  for (const link of links) {
    if (await isNoted(d.redis, 'orders', link.id)) continue;
    try {
      const { post, digest } = await buildOrderPostWithDigest(d, link);
      try {
        await d.submit(post.title, post.body);
      } catch (e) {
        if (!digest) throw e;
        // A missed order is worse than a plain one: if Reddit refuses the digest, post the simple version.
        d.log(`WARN digest post rejected for ${link.url}: ${message(e)}; posting the simple version`);
        const simple = buildOrderPost(link, d.now());
        await d.submit(simple.title, simple.body);
      }
      await markNoted(d.redis, 'orders', link.id);
      d.log(`Posted order ${link.id}`);
    } catch (e) {
      d.log(`Exception (find_and_post_orders) ${link.id}: ${message(e)}`);
    }
  }
}
