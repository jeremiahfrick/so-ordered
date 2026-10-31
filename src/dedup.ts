// Structural subset of Devvit's RedisClient (`redis` from '@devvit/web/server' satisfies it).
export type RedisLike = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<unknown>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hSet(key: string, fieldValues: { [field: string]: string }): Promise<unknown>;
};

export type Kind = 'cases' | 'orders';
export type Seed = { cases: string[]; orders: string[] };

const HASH: Record<Kind, string> = { cases: 'noted_cases', orders: 'noted_orders' };
const INITIALIZED = 'initialized';

export async function isInitialized(r: RedisLike): Promise<boolean> {
  return (await r.get(INITIALIZED)) === '1';
}

export async function isNoted(r: RedisLike, kind: Kind, id: string): Promise<boolean> {
  return (await r.hGet(HASH[kind], id)) !== undefined;
}

export async function markNoted(r: RedisLike, kind: Kind, id: string): Promise<void> {
  await r.hSet(HASH[kind], { [id]: '1' });
}

// Marks the given items as already seen, then flags the app as started. Idempotent: items noted since are kept.
export async function initialize(r: RedisLike, seed?: Seed): Promise<void> {
  if (seed) {
    for (const kind of ['cases', 'orders'] as const) {
      if (seed[kind].length > 0) {
        await r.hSet(HASH[kind], Object.fromEntries(seed[kind].map((id) => [id, '1'])));
      }
    }
  }
  await r.set(INITIALIZED, '1');
}
