import { createServer, getServerPort, reddit, redis } from '@devvit/web/server';
import { initialize } from '../dedup';
import { fetchPdfBytes } from '../fetchPdf';
import { pdfToText } from '../pdf';
import { PollDeps, runPoll } from '../poll';
import { RouteDeps, route, toHttp } from '../routes';
import { seed } from '../seed';

const pollDeps: PollDeps = {
  fetchText: async (url, headers) => {
    const res = await fetch(url, headers ? { headers } : undefined);
    return { status: res.status, text: await res.text() };
  },
  fetchBytes: (url) => fetchPdfBytes(url),
  pdfText: pdfToText,
  // The subreddit defaults to the one the app is installed on; the app account is the author.
  submit: async (title, body) => {
    await reddit.submitPost({ title, text: body });
  },
  redis,
  log: (m) => console.log(m),
  now: () => new Date(),
};

const routeDeps: RouteDeps = {
  poll: () => runPoll(pollDeps),
  initSeed: () => initialize(redis, seed),
  initEmpty: () => initialize(redis),
  log: (m) => console.log(m),
};

const server = createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0];
  const r = toHttp(await route(path, routeDeps));
  res.writeHead(r.status, r.headers);
  res.end(r.payload);
});

server.listen(getServerPort());
