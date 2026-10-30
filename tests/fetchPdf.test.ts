import { fetchPdfBytes } from '../src/fetchPdf';

const resp = (status: number, bytes: Uint8Array, contentLength?: number) => ({
  status,
  headers: { get: (h: string) => (h.toLowerCase() === 'content-length' && contentLength !== undefined ? String(contentLength) : null) },
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

describe('fetchPdfBytes', () => {
  test('returns the status and bytes', async () => {
    const out = await fetchPdfBytes('https://x/a.pdf', { fetchImpl: (async () => resp(200, new Uint8Array([1, 2, 3]))) as any });
    expect(out.status).toBe(200);
    expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
  });

  test('a response that never arrives times out instead of blocking the poll', async () => {
    const never = (() => new Promise(() => {})) as any;
    await expect(fetchPdfBytes('https://x/a.pdf', { timeoutMs: 20, fetchImpl: never })).rejects.toThrow(/timed out/);
  });

  test('a body that never finishes downloading times out too', async () => {
    const slowBody = (async () => ({ status: 200, headers: { get: () => null }, arrayBuffer: () => new Promise(() => {}) })) as any;
    await expect(fetchPdfBytes('https://x/a.pdf', { timeoutMs: 20, fetchImpl: slowBody })).rejects.toThrow(/timed out/);
  });

  test('a declared content-length over the cap is rejected before downloading', async () => {
    let downloaded = false;
    const f = (async () => ({
      ...resp(200, new Uint8Array(1), 5_000_000),
      arrayBuffer: async () => {
        downloaded = true;
        return new ArrayBuffer(1);
      },
    })) as any;
    await expect(fetchPdfBytes('https://x/a.pdf', { maxBytes: 1_000_000, fetchImpl: f })).rejects.toThrow(/too large/);
    expect(downloaded).toBe(false);
  });

  test('a body over the cap is rejected even without a content-length', async () => {
    const f = (async () => resp(200, new Uint8Array(2000))) as any;
    await expect(fetchPdfBytes('https://x/a.pdf', { maxBytes: 1000, fetchImpl: f })).rejects.toThrow(/too large/);
  });
});
