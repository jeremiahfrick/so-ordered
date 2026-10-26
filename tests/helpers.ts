import { RedisLike } from '../src/dedup';

export function fakeRedis(): RedisLike & { strings: Map<string, string>; hashes: Map<string, Record<string, string>> } {
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
