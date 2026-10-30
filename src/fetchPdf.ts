export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

// A PDF is a bonus, so it must never hold up the poll: bounded in time and in size. Any problem throws, which
// makes the caller fall back to the simple post.
export async function fetchPdfBytes(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; fetchImpl?: FetchLike } = {}
): Promise<{ status: number; bytes: Uint8Array }> {
  const { timeoutMs = 15_000, maxBytes = 15_000_000 } = opts;
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error(`PDF fetch timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  const work = (async () => {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller?.signal });
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`PDF too large (${declared} bytes)`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error(`PDF too large (${buf.byteLength} bytes)`);
    return { status: res.status, bytes: new Uint8Array(buf) };
  })();
  work.catch(() => {}); // if the timeout wins, a late failure of the abandoned download must not be unhandled

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
