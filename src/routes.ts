export type RouteDeps = {
  poll: () => Promise<void>;
  log: (m: string) => void;
};

type Result = { status: number; body: Record<string, unknown> };

export async function route(path: string, d: RouteDeps): Promise<Result> {
  try {
    switch (path) {
      case '/internal/scheduler/poll':
        await d.poll();
        return { status: 200, body: {} };
      default:
        return { status: 404, body: { error: 'not found' } };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    d.log(`Exception (${path}): ${msg}`);
    return { status: 500, body: { error: msg } };
  }
}

// Devvit rejects responses without Content-Length, so it is always set (in bytes).
export function toHttp(r: Result): { status: number; headers: Record<string, string | number>; payload: string } {
  const payload = JSON.stringify(r.body);
  return {
    status: r.status,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    payload,
  };
}
