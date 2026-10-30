import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialize, isNoted } from '../src/dedup';
import { PollDeps, runPoll } from '../src/poll';
import { fakeRedis } from './helpers';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const RSS = 'https://www.supremecourt.gov/RSS/slipopinion_rss.aspx';
const ORDERS = 'https://www.supremecourt.gov/orders/ordersofthecourt/';
const CASE = (n: string) => `https://www.supremecourt.gov/RSS/Cases/JSON/${n}.json`;
const SLIP = 'https://www.supremecourt.gov/opinions/slipopinion/25'; // case fixtures are dated 2026-04/05 => term 25

type Res = { status: number; text: string };
const ok = (text: string): Res => ({ status: 200, text });

const rss = (titles: string[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${titles
    .map((t, i) => `<item><title><![CDATA[${t}]]></title><description><![CDATA[Sum.]]></description><link>http://x/${i}.pdf</link></item>`)
    .join('')}</channel></rss>`;

async function setup(routes: Record<string, Res>, opts: { initialized?: boolean; failFirstSubmits?: number } = {}) {
  const redis = fakeRedis();
  if (opts.initialized !== false) await initialize(redis);
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const posts: { title: string; body: string }[] = [];
  const logs: string[] = [];
  let toFail = opts.failFirstSubmits ?? 0;
  let clock = new Date('2026-10-06T02:30:00Z'); // 10/05 evening in New York
  const deps: PollDeps = {
    fetchText: async (url, headers) => {
      calls.push({ url, headers });
      return routes[url] ?? { status: 404, text: '' };
    },
    submit: async (title, body) => {
      if (toFail > 0) {
        toFail--;
        throw new Error('reddit down');
      }
      posts.push({ title, body });
    },
    redis,
    log: (m) => logs.push(m),
    now: () => clock,
  };
  const advance = (minutes: number) => {
    clock = new Date(clock.getTime() + minutes * 60_000);
  };
  return { deps, redis, calls, posts, logs, advance };
}

const emptyOrders = ok('<html><body></body></html>');

describe('runPoll', () => {
  test('uninitialized posts nothing and fetches nothing', async () => {
    const s = await setup({ [RSS]: ok(rss(['A v. B (24A884)'])), [ORDERS]: emptyOrders }, { initialized: false });
    await runPoll(s.deps);
    expect(s.posts).toEqual([]);
    expect(s.calls).toEqual([]);
    expect(s.logs.some((l) => l.includes('WARN not initialized'))).toBe(true);
  });

  test('new opinion is fetched, posted, then noted; a noted opinion is not posted again', async () => {
    const s = await setup({
      [RSS]: ok(rss(['A v. B (24A884)'])),
      [CASE('24A884')]: ok(fixture('case_24-1056.json')),
      [SLIP]: ok(fixture('slipopinion_24.html')),
      [ORDERS]: emptyOrders,
    });
    await runPoll(s.deps);
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0].title).toBe('OPINION: Isabel Rico, Petitioner v. United States');
    expect(s.posts[0].body).toContain('\nAuthor|Justice Amy Coney Barrett\n');
    expect(await isNoted(s.redis, 'cases', '24A884')).toBe(true);

    await runPoll(s.deps);
    expect(s.posts).toHaveLength(1);
  });

  test('case JSON is fetched with a browser User-Agent', async () => {
    const s = await setup({
      [RSS]: ok(rss(['A v. B (24A884)'])),
      [CASE('24A884')]: ok(fixture('case_24-1056.json')),
      [SLIP]: ok(fixture('slipopinion_24.html')),
      [ORDERS]: emptyOrders,
    });
    await runPoll(s.deps);
    expect(s.calls.find((c) => c.url === CASE('24A884'))?.headers).toEqual({ 'User-Agent': 'Mozilla/5.0' });
  });

  test('a failed submit leaves that item un-noted and later items still post', async () => {
    const s = await setup(
      {
        [RSS]: ok(rss(['A v. B (24A884)', 'C v. D (24-809)'])),
        [CASE('24A884')]: ok(fixture('case_24-1056.json')),
        [CASE('24-809')]: ok(fixture('case_24-1056.json')),
        [SLIP]: ok(fixture('slipopinion_24.html')),
        [ORDERS]: emptyOrders,
      },
      { failFirstSubmits: 1 }
    );
    await runPoll(s.deps);
    expect(s.posts).toHaveLength(1);
    expect(await isNoted(s.redis, 'cases', '24A884')).toBe(false);
    expect(await isNoted(s.redis, 'cases', '24-809')).toBe(true);
    expect(s.logs.some((l) => l.includes('reddit down'))).toBe(true);
  });

  test('author lookup failure still posts, with an empty Author cell', async () => {
    const s = await setup({
      [RSS]: ok(rss(['A v. B (24A884)'])),
      [CASE('24A884')]: ok(fixture('case_24-1056.json')),
      [ORDERS]: emptyOrders, // slip page route missing => 404
    });
    await runPoll(s.deps);
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0].body).toContain('\nAuthor|\n');
    expect(await isNoted(s.redis, 'cases', '24A884')).toBe(true);
  });

  test('case JSON that cannot be fetched leaves the item un-noted', async () => {
    const s = await setup({ [RSS]: ok(rss(['A v. B (24A884)'])), [ORDERS]: emptyOrders });
    await runPoll(s.deps);
    expect(s.posts).toEqual([]);
    expect(await isNoted(s.redis, 'cases', '24A884')).toBe(false);
  });

  test('opinions feed returning 500 logs a warning and orders are still polled', async () => {
    const s = await setup({ [RSS]: { status: 500, text: '' }, [ORDERS]: ok(fixture('orders.html')) });
    await runPoll(s.deps);
    expect(s.logs.some((l) => l.includes('WARN opinions feed status 500'))).toBe(true);
    expect(s.posts.length).toBeGreaterThan(0);
  });

  test('orders page with 200 but no matching links logs a distinct warning and posts nothing', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: ok('<html><a href="/x.pdf">Calendar</a></html>') });
    await runPoll(s.deps);
    expect(s.logs.some((l) => l.includes('WARN no order links'))).toBe(true);
    expect(s.posts).toEqual([]);
  });

  test('orders page returning 500 marks nothing, and opinions in the same run still post', async () => {
    const s = await setup({
      [RSS]: ok(rss(['A v. B (24A884)'])),
      [CASE('24A884')]: ok(fixture('case_24-1056.json')),
      [SLIP]: ok(fixture('slipopinion_24.html')),
      [ORDERS]: { status: 500, text: 'oops' },
    });
    await runPoll(s.deps);
    expect(s.logs.some((l) => l.includes('WARN orders page status 500'))).toBe(true);
    expect(s.posts).toHaveLength(1);
    expect(s.redis.hashes.get('noted_orders')).toBeUndefined();
  });

  test('new orders post in page order and are noted by URL; noted ones are skipped', async () => {
    const first = 'https://www.supremecourt.gov/orders/courtorders/102126zr_5i36.pdf';
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: ok(fixture('orders.html')) });
    await runPoll(s.deps);
    expect(s.posts).toHaveLength(12);
    expect(s.posts[0]).toEqual({
      title: 'ORDERS: Miscellaneous Order (10/21/2026)', // the date comes from the filename 102126zr_...
      body: `Date: 10/21/2026\n\n[Miscellaneous Order](${first})`,
    });
    expect(await isNoted(s.redis, 'orders', first)).toBe(true);

    await runPoll(s.deps);
    expect(s.posts).toHaveLength(12);
  });
});

describe('logging', () => {
  test('an idle tick is silent apart from an hourly heartbeat', async () => {
    // A healthy idle tick: the orders page lists only orders that are already noted.
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: ok(fixture('orders.html')) });
    await runPoll(s.deps); // first tick posts the 12 orders and logs the first heartbeat
    expect(s.logs.filter((l) => l.startsWith('HEARTBEAT'))).toHaveLength(1);
    const afterFirst = s.logs.length;

    s.advance(2);
    await runPoll(s.deps);
    s.advance(2);
    await runPoll(s.deps);
    expect(s.logs).toHaveLength(afterFirst); // nothing new within the hour

    s.advance(60);
    await runPoll(s.deps);
    expect(s.logs.filter((l) => l.startsWith('HEARTBEAT'))).toHaveLength(2);
  });

  test('a tick that finds nothing new never logs "Posted 0"', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: ok(fixture('orders.html')) });
    await runPoll(s.deps); // posts all 12
    s.logs.length = 0;
    s.advance(2);
    await runPoll(s.deps);
    expect(s.logs).toEqual([]);
  });

  test('each post is logged', async () => {
    const s = await setup({
      [RSS]: ok(rss(['A v. B (24A884)'])),
      [CASE('24A884')]: ok(fixture('case_24-1056.json')),
      [SLIP]: ok(fixture('slipopinion_24.html')),
      [ORDERS]: ok(fixture('orders.html')),
    });
    await runPoll(s.deps);
    expect(s.logs.filter((l) => l.startsWith('Posted opinion 24A884'))).toHaveLength(1);
    expect(s.logs.filter((l) => l.startsWith('Posted order '))).toHaveLength(12);
  });

  test('the not-initialized warning is logged once per hour, not every tick', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: emptyOrders }, { initialized: false });
    await runPoll(s.deps);
    s.advance(2);
    await runPoll(s.deps);
    s.advance(2);
    await runPoll(s.deps);
    expect(s.logs.filter((l) => l.includes('WARN not initialized'))).toHaveLength(1);

    s.advance(60);
    await runPoll(s.deps);
    expect(s.logs.filter((l) => l.includes('WARN not initialized'))).toHaveLength(2);
  });
});
