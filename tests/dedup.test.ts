import { initialize, isInitialized, isNoted, markNoted } from '../src/dedup';
import { fakeRedis } from './helpers';

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
