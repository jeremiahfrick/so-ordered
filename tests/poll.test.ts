import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialize, isInitialized, isNoted } from '../src/dedup';
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

type SetupOpts = { initialized?: boolean; failFirstSubmits?: number; pdfs?: Record<string, string>; pdfThrows?: boolean };

async function setup(routes: Record<string, Res>, opts: SetupOpts = {}) {
  const redis = fakeRedis();
  if (opts.initialized !== false) await initialize(redis);
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const posts: { title: string; body: string }[] = [];
  const logs: string[] = [];
  let toFail = opts.failFirstSubmits ?? 0;
  const pdfCalls: string[] = [];
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let clock = new Date('2026-10-06T02:30:00Z'); // 10/05 evening in New York
  let version = '0.0.7';
  if (opts.initialized !== false) await redis.set('last_version', version); // an app that has already run this version
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
    // A fake "PDF" is just its extracted text encoded as bytes; URLs not in opts.pdfs return 404.
    fetchBytes: async (url) => {
      pdfCalls.push(url);
      const body = opts.pdfs?.[url];
      return body === undefined ? { status: 404, bytes: new Uint8Array() } : { status: 200, bytes: enc.encode(body) };
    },
    pdfText: async (bytes) => {
      if (opts.pdfThrows) throw new Error('pdf extraction failed');
      return dec.decode(bytes);
    },
    redis,
    log: (m) => logs.push(m),
    now: () => clock,
    appVersion: () => version,
  };
  const advance = (minutes: number) => {
    clock = new Date(clock.getTime() + minutes * 60_000);
  };
  const setVersion = (v: string) => {
    version = v;
  };
  return { deps, redis, calls, posts, logs, advance, pdfCalls, setVersion };
}

const emptyOrders = ok('<html><body></body></html>');

describe('first run on a fresh install', () => {
  const firstOrder = 'https://www.supremecourt.gov/orders/courtorders/102126zr_5i36.pdf';

  test('marks everything already on the Court site as seen, posts nothing, and starts the app', async () => {
    const s = await setup(
      { [RSS]: ok(rss(['A v. B (24A884)'])), [ORDERS]: ok(fixture('orders.html')) },
      { initialized: false }
    );
    await runPoll(s.deps);
    expect(s.posts).toEqual([]);
    expect(await isInitialized(s.redis)).toBe(true);
    expect(await isNoted(s.redis, 'cases', '24A884')).toBe(true);
    expect(await isNoted(s.redis, 'orders', firstOrder)).toBe(true);
    expect(Object.keys(s.redis.hashes.get('noted_orders') ?? {})).toHaveLength(12);
    // only the two listing pages are fetched: no case JSON, no PDFs
    expect(s.calls.map((c) => c.url).sort()).toEqual([ORDERS, RSS].sort());
    expect(s.pdfCalls).toEqual([]);
    expect(s.logs).toEqual([
      'VERSION 0.0.7 running (first run)',
      expect.stringMatching(/^Initialized: skipped 1 opinion and 12 orders already on the Court's site/),
    ]);
  });

  test('later ticks post only what is new since the first run', async () => {
    const s = await setup(
      { [RSS]: ok(rss(['A v. B (24A884)'])), [ORDERS]: ok(fixture('orders.html')) },
      { initialized: false }
    );
    await runPoll(s.deps);

    s.advance(2);
    const newOrder = 'https://www.supremecourt.gov/orders/courtorders/110226zr_zzzz.pdf';
    const html = fixture('orders.html').replace('</body>', `<a href="${newOrder}">Miscellaneous Order</a></body>`);
    const routes = {
      [RSS]: ok(rss(['A v. B (24A884)', 'C v. D (24-809)'])),
      [CASE('24-809')]: ok(fixture('case_24-1056.json')),
      [SLIP]: ok(fixture('slipopinion_24.html')),
      [ORDERS]: ok(html),
    };
    s.deps.fetchText = async (url) => routes[url] ?? { status: 404, text: '' };
    await runPoll(s.deps);
    expect(s.posts).toHaveLength(2);
    expect(s.logs.filter((l) => l.startsWith('Posted opinion 24-809'))).toHaveLength(1);
    expect(s.logs.filter((l) => l.startsWith('Posted order ') && l.includes('110226zr_zzzz'))).toHaveLength(1);
  });

  test.each([
    ['the opinions feed fails', { [RSS]: { status: 500, text: '' }, [ORDERS]: ok(fixture('orders.html')) }, 'WARN opinions feed status 500'],
    ['the orders page fails', { [RSS]: ok(rss(['A v. B (24A884)'])), [ORDERS]: { status: 500, text: '' } }, 'WARN orders page status 500'],
    ['the orders page has no order links', { [RSS]: ok(rss(['A v. B (24A884)'])), [ORDERS]: emptyOrders }, 'WARN no order links'],
  ])('stays uninitialized and marks nothing when %s, then retries', async (_name, routes, warning) => {
    const s = await setup(routes as Record<string, Res>, { initialized: false });
    await runPoll(s.deps);
    expect(await isInitialized(s.redis)).toBe(false);
    expect(s.redis.hashes.size).toBe(0);
    expect(s.posts).toEqual([]);
    expect(s.logs.some((l) => l.includes(warning))).toBe(true);
  });

  test('a failed first run is retried on the next tick', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: { status: 500, text: '' } }, { initialized: false });
    await runPoll(s.deps);
    expect(await isInitialized(s.redis)).toBe(false);

    const routes: Record<string, Res> = { [RSS]: ok(rss([])), [ORDERS]: ok(fixture('orders.html')) };
    s.deps.fetchText = async (url) => routes[url] ?? { status: 404, text: '' };
    s.advance(2);
    await runPoll(s.deps);
    expect(await isInitialized(s.redis)).toBe(true);
    expect(s.posts).toEqual([]);
  });

  test('an empty opinions feed is fine (nothing published yet this term)', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: ok(fixture('orders.html')) }, { initialized: false });
    await runPoll(s.deps);
    expect(await isInitialized(s.redis)).toBe(true);
    expect(s.logs.some((l) => /skipped 0 opinions and 12 orders/.test(l))).toBe(true);
  });
});

describe('runPoll', () => {
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

  test('the heartbeat names the running app version', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: ok(fixture('orders.html')) });
    await runPoll(s.deps);
    expect(s.logs.filter((l) => l.startsWith('HEARTBEAT'))).toEqual(['HEARTBEAT v0.0.7 polling ok at 2026-10-06T02:30:00.000Z']);
  });

  test('a new version is logged once, on the first tick it runs, with the previous version', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: ok(fixture('orders.html')) });
    await runPoll(s.deps);
    expect(s.logs.filter((l) => l.startsWith('VERSION'))).toEqual([]); // same version as before: silent

    s.setVersion('0.0.8');
    s.advance(2);
    await runPoll(s.deps);
    s.advance(2);
    await runPoll(s.deps);
    expect(s.logs.filter((l) => l.startsWith('VERSION'))).toEqual(['VERSION 0.0.8 running (was 0.0.7)']);
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

  test('a Court outage while running warns once per hour per problem, not every tick', async () => {
    const s = await setup({ [RSS]: { status: 503, text: '' }, [ORDERS]: { status: 503, text: '' } });
    for (let i = 0; i < 5; i++) {
      await runPoll(s.deps);
      s.advance(2);
    }
    expect(s.logs.filter((l) => l.includes('WARN opinions feed status 503'))).toHaveLength(1);
    expect(s.logs.filter((l) => l.includes('WARN orders page status 503'))).toHaveLength(1);

    s.advance(60);
    await runPoll(s.deps);
    expect(s.logs.filter((l) => l.includes('WARN opinions feed status 503'))).toHaveLength(2);
    expect(s.logs.filter((l) => l.includes('WARN orders page status 503'))).toHaveLength(2);
  });

  test('a network error while polling is logged once per hour, and polling carries on', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: ok(fixture('orders.html')) });
    s.deps.fetchText = async () => {
      throw new Error('fetch failed');
    };
    for (let i = 0; i < 4; i++) {
      await runPoll(s.deps);
      s.advance(2);
    }
    expect(s.logs.filter((l) => l.startsWith('Exception (pollOpinions): fetch failed'))).toHaveLength(1);
    expect(s.logs.filter((l) => l.startsWith('Exception (pollOrders): fetch failed'))).toHaveLength(1);
  });

  test('a failing first run warns once per hour, not every tick', async () => {
    const s = await setup({ [RSS]: { status: 500, text: '' }, [ORDERS]: emptyOrders }, { initialized: false });
    await runPoll(s.deps);
    s.advance(2);
    await runPoll(s.deps);
    s.advance(2);
    await runPoll(s.deps);
    expect(s.logs.filter((l) => l.includes('WARN opinions feed status 500'))).toHaveLength(1);

    s.advance(60);
    await runPoll(s.deps);
    expect(s.logs.filter((l) => l.includes('WARN opinions feed status 500'))).toHaveLength(2);
  });
});

describe('opinion lineup', () => {
  const PDF = 'http://x/0.pdf'; // the rss() helper links the first item here
  const golden = JSON.parse(fixture('lineups_golden.json'));
  const routes = {
    [RSS]: ok(rss(['A v. B (24A884)'])),
    [CASE('24A884')]: ok(fixture('case_24-1056.json')),
    [SLIP]: ok(fixture('slipopinion_24.html')),
    [ORDERS]: emptyOrders,
  };
  const withoutLineup = async () => {
    const s = await setup(routes);
    await runPoll(s.deps);
    return s.posts[0].body;
  };

  test("the lineup from the opinion's PDF is appended after the opinion table", async () => {
    const s = await setup(routes, { pdfs: { [PDF]: fixture('lineups_text/24-1056_qn12.txt') } });
    await runPoll(s.deps);
    expect(s.pdfCalls).toEqual([PDF]);
    expect(s.posts[0].body).toBe(`${await withoutLineup()}\n${golden['24-1056_qn12'].section}`);
    expect(s.posts[0].body).toContain('\nJudge|Majority|Concurrence|Dissent\n');
    expect(s.logs.some((l) => l.startsWith('Lineup skipped'))).toBe(false);
    expect(await isNoted(s.redis, 'cases', '24A884')).toBe(true);
  });

  test('a PDF that cannot be fetched posts without a lineup and logs one line', async () => {
    const s = await setup(routes); // no pdfs => 404
    await runPoll(s.deps);
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0].body).not.toContain('Judge|Majority');
    expect(s.logs.filter((l) => l.startsWith('Lineup skipped'))).toEqual(['Lineup skipped (24A884): PDF status 404']);
    expect(await isNoted(s.redis, 'cases', '24A884')).toBe(true);
  });

  test('a PDF whose text extraction throws posts without a lineup', async () => {
    const s = await setup(routes, { pdfs: { [PDF]: 'x' }, pdfThrows: true });
    await runPoll(s.deps);
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0].body).not.toContain('Judge|Majority');
    expect(s.logs.some((l) => l.includes('Lineup skipped (24A884): pdf extraction failed'))).toBe(true);
  });

  test('a PDF without a lineup posts the plain opinion table and logs nothing', async () => {
    const s = await setup(routes, { pdfs: { [PDF]: 'an opinion with no syllabus lineup' } });
    await runPoll(s.deps);
    expect(s.posts[0].body).toBe(await withoutLineup());
    expect(s.logs.some((l) => l.startsWith('Lineup skipped'))).toBe(false);
  });
});

describe('order digests', () => {
  const base = 'https://www.supremecourt.gov/orders/courtorders/';
  const miscUrl = base + '102126zr_5i36.pdf';
  const page = (url: string, label = 'Miscellaneous Order') => ok(`<html><body><a href="${url}">${label}</a></body></html>`);
  const miscText = fixture('orders_text/102126zr_5i36.txt');
  const simple = { title: 'ORDERS: Miscellaneous Order (10/21/2026)', body: `Date: 10/21/2026\n\n[Miscellaneous Order](${miscUrl})` };
  const digestTitle = 'ORDERS: Miscellaneous Order — 26A416 (10/21/2026)';

  test('a new miscellaneous order is posted with its order text', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: page(miscUrl) }, { pdfs: { [miscUrl]: miscText } });
    await runPoll(s.deps);
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0].title).toBe(digestTitle);
    expect(s.posts[0].body).toContain('> The application for stay presented to The Chief Justice');
    expect(await isNoted(s.redis, 'orders', miscUrl)).toBe(true);
    expect(s.logs.some((l) => l.includes('WARN orders digest failed'))).toBe(false);
  });

  test('a PDF that cannot be fetched posts the simple post, logs one warning, and notes the order', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: page(miscUrl) }); // no pdfs => 404
    await runPoll(s.deps);
    expect(s.posts).toEqual([simple]);
    expect(s.logs.filter((l) => l.startsWith('WARN orders digest failed'))).toEqual([
      `WARN orders digest failed for ${miscUrl}: PDF status 404`,
    ]);
    expect(await isNoted(s.redis, 'orders', miscUrl)).toBe(true);
  });

  test('a PDF whose text extraction throws falls back to the simple post', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: page(miscUrl) }, { pdfs: { [miscUrl]: miscText }, pdfThrows: true });
    await runPoll(s.deps);
    expect(s.posts).toEqual([simple]);
    expect(s.logs.some((l) => l.includes('pdf extraction failed'))).toBe(true);
  });

  test('empty text and an unrecognized layout fall back to the simple post', async () => {
    for (const text of ['', 'hello world, not an order']) {
      const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: page(miscUrl) }, { pdfs: { [miscUrl]: text } });
      await runPoll(s.deps);
      expect(s.posts).toEqual([simple]);
      expect(s.logs.some((l) => l.includes('unrecognized layout'))).toBe(true);
    }
  });

  test('a digest over the size cap falls back to the simple post', async () => {
    const huge = '(ORDER LIST: 610 U.S.)\nWEDNESDAY, OCTOBER 21, 2026\nORDER IN PENDING CASE\n26A1 A V. B\n' + 'word '.repeat(9000);
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: page(miscUrl) }, { pdfs: { [miscUrl]: huge } });
    await runPoll(s.deps);
    expect(s.posts).toEqual([simple]);
    expect(s.logs.some((l) => l.includes('digest too long'))).toBe(true);
  });

  test('if Reddit rejects the digest post, the simple post is submitted instead', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: page(miscUrl) }, { pdfs: { [miscUrl]: miscText }, failFirstSubmits: 1 });
    await runPoll(s.deps);
    expect(s.posts).toEqual([simple]);
    expect(s.logs.some((l) => l.includes('WARN digest post rejected'))).toBe(true);
    expect(await isNoted(s.redis, 'orders', miscUrl)).toBe(true);
  });

  test('if both the digest and the simple post are rejected, nothing is noted and the order is retried next tick', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: page(miscUrl) }, { pdfs: { [miscUrl]: miscText }, failFirstSubmits: 2 });
    await runPoll(s.deps);
    expect(s.posts).toEqual([]);
    expect(await isNoted(s.redis, 'orders', miscUrl)).toBe(false);
  });

  test('an order list is posted as a digest', async () => {
    const listUrl = base + '101926zor_q8l1.pdf';
    const s = await setup(
      { [RSS]: ok(rss([])), [ORDERS]: page(listUrl, 'Order List') },
      { pdfs: { [listUrl]: fixture('orders_text/101926zor_q8l1.txt') } }
    );
    await runPoll(s.deps);
    expect(s.posts[0].title).toBe('ORDERS: Order List (10/19/2026)');
    expect(s.posts[0].body).toContain('CERTIORARI GRANTED|2');
  });

  test('an already-noted order does not fetch its PDF', async () => {
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: page(miscUrl) }, { pdfs: { [miscUrl]: miscText } });
    await runPoll(s.deps);
    s.pdfCalls.length = 0;
    s.advance(2);
    await runPoll(s.deps);
    expect(s.pdfCalls).toEqual([]);
  });

  test('a failing digest does not stop the other orders from posting', async () => {
    const other = base + '102026zr_2d9g.pdf';
    const html = ok(`<html><a href="${miscUrl}">Miscellaneous Order</a><a href="${other}">Miscellaneous Order</a></html>`);
    const s = await setup({ [RSS]: ok(rss([])), [ORDERS]: html }, { pdfs: { [other]: fixture('orders_text/102026zr_2d9g.txt') } });
    await runPoll(s.deps);
    expect(s.posts).toHaveLength(2);
    expect(s.posts[0]).toEqual(simple);
    expect(s.posts[1].title).toBe('ORDERS: Miscellaneous Order — 26-5865 (10/20/2026)');
  });
});
