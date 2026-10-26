import { RedisLike, initialize, isInitialized, isNoted, markNoted, parseSeedFiles } from '../src/dedup';
import { seed } from '../src/seed';

function fakeRedis(): RedisLike & { strings: Map<string, string>; hashes: Map<string, Record<string, string>> } {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Record<string, string>>();
  return {
    strings,
    hashes,
    get: async (k) => strings.get(k),
    set: async (k, v) => {
      strings.set(k, v);
      return 'OK';
    },
    hGet: async (k, f) => hashes.get(k)?.[f],
    hSet: async (k, fv) => {
      hashes.set(k, { ...(hashes.get(k) ?? {}), ...fv });
      return Object.keys(fv).length;
    },
  };
}

describe('dedup store', () => {
  test('not initialized until initialize() runs, even with no seed', async () => {
    const r = fakeRedis();
    expect(await isInitialized(r)).toBe(false);
    await initialize(r);
    expect(await isInitialized(r)).toBe(true);
    expect(await isNoted(r, 'cases', '24-1')).toBe(false);
  });

  test('initialize(seed) marks seeded cases and orders as noted', async () => {
    const r = fakeRedis();
    await initialize(r, { cases: ['24-1', '141, Orig.'], orders: ['https://x/a.pdf'] });
    expect(await isNoted(r, 'cases', '24-1')).toBe(true);
    expect(await isNoted(r, 'cases', '141, Orig.')).toBe(true);
    expect(await isNoted(r, 'orders', 'https://x/a.pdf')).toBe(true);
    expect(await isNoted(r, 'orders', '24-1')).toBe(false);
  });

  test('initialize is idempotent and does not forget items noted since', async () => {
    const r = fakeRedis();
    const s = { cases: ['24-1'], orders: [] };
    await initialize(r, s);
    await markNoted(r, 'cases', '25-9');
    await initialize(r, s);
    expect(await isNoted(r, 'cases', '24-1')).toBe(true);
    expect(await isNoted(r, 'cases', '25-9')).toBe(true);
    expect(r.hashes.get('noted_cases')).toEqual({ '24-1': '1', '25-9': '1' });
  });

  test('markNoted then isNoted', async () => {
    const r = fakeRedis();
    expect(await isNoted(r, 'orders', 'u')).toBe(false);
    await markNoted(r, 'orders', 'u');
    expect(await isNoted(r, 'orders', 'u')).toBe(true);
  });
});

describe('parseSeedFiles', () => {
  test('drops blank lines and trims carriage returns and spaces', () => {
    expect(parseSeedFiles('24-1\r\n\r\n 24-2 \n', 'u1\r\n\nu2')).toEqual({ cases: ['24-1', '24-2'], orders: ['u1', 'u2'] });
  });
});

describe('bundled seed snapshot', () => {
  test('is non-empty and contains clean ids', () => {
    expect(seed.cases.length).toBeGreaterThan(0);
    expect(seed.orders.length).toBeGreaterThan(0);
    for (const id of [...seed.cases, ...seed.orders]) expect(id).toBe(id.trim());
    expect(seed.orders.every((u) => u.startsWith('https://www.supremecourt.gov/'))).toBe(true);
  });
});
