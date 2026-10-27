import { RouteDeps, route, toHttp } from '../src/routes';

function fakeDeps(overrides: Partial<RouteDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: RouteDeps = {
    poll: async () => void calls.push('poll'),
    initSeed: async () => void calls.push('initSeed'),
    initEmpty: async () => void calls.push('initEmpty'),
    log: (m) => logs.push(m),
    ...overrides,
  };
  return { deps, calls, logs };
}

describe('route', () => {
  test('/internal/scheduler/poll runs poll and answers {}', async () => {
    const { deps, calls } = fakeDeps();
    expect(await route('/internal/scheduler/poll', deps)).toEqual({ status: 200, body: {} });
    expect(calls).toEqual(['poll']);
  });

  test('/internal/menu/init-seed runs only initSeed and answers a toast', async () => {
    const { deps, calls } = fakeDeps();
    const res = await route('/internal/menu/init-seed', deps);
    expect(calls).toEqual(['initSeed']);
    expect(res.status).toBe(200);
    expect(typeof res.body.showToast).toBe('string');
    expect((res.body.showToast as string).length).toBeGreaterThan(0);
  });

  test('/internal/menu/init-empty runs only initEmpty and answers a toast', async () => {
    const { deps, calls } = fakeDeps();
    const res = await route('/internal/menu/init-empty', deps);
    expect(calls).toEqual(['initEmpty']);
    expect((res.body.showToast as string).length).toBeGreaterThan(0);
  });

  test('an unknown path is a 404 and calls nothing', async () => {
    const { deps, calls } = fakeDeps();
    expect(await route('/internal/nope', deps)).toEqual({ status: 404, body: { error: 'not found' } });
    expect(calls).toEqual([]);
  });

  test('a throwing handler becomes a 500 with the message, and is logged', async () => {
    const { deps, logs } = fakeDeps({
      poll: async () => {
        throw new Error('boom');
      },
    });
    expect(await route('/internal/scheduler/poll', deps)).toEqual({ status: 500, body: { error: 'boom' } });
    expect(logs.some((l) => l.includes('boom'))).toBe(true);
  });
});

describe('toHttp', () => {
  test('{} has content-length 2 and a JSON content type', () => {
    expect(toHttp({ status: 200, body: {} })).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': 2 },
      payload: '{}',
    });
  });

  test('content-length counts bytes, not characters', () => {
    const r = toHttp({ status: 200, body: { showToast: 'Court’s order' } });
    expect(r.headers['content-length']).toBe(Buffer.byteLength(r.payload));
    expect(Buffer.byteLength(r.payload)).toBeGreaterThan(r.payload.length);
  });

  test('keeps the status', () => {
    expect(toHttp({ status: 404, body: { error: 'not found' } }).status).toBe(404);
  });
});
