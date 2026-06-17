/**
 * Express example for latency-lab.
 *
 * Run:
 *   npx tsx examples/express-example.ts
 *
 * Then try:
 *   curl http://localhost:3000/api/users
 *   curl http://localhost:3000/health     # excluded — no chaos
 *   watch -n1 curl -s http://localhost:3000/api/posts
 */

import http from 'node:http';
import { chaosMiddleware, presets } from '../src/index.js';

// ---------------------------------------------------------------------------
// Minimal Connect-compatible server without requiring the Express package
// ---------------------------------------------------------------------------

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: (err?: unknown) => void,
) => void;

function createApp(): {
  use: (handler: Handler) => void;
  get: (path: string, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) => void;
  listen: (port: number, cb?: () => void) => http.Server;
} {
  const middlewares: Handler[] = [];
  const routes: Array<{
    path: string;
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  }> = [];

  function runMiddlewares(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    idx: number,
  ): void {
    if (idx >= middlewares.length) {
      // No middleware handled it — try routes
      const route = routes.find((r) => req.url === r.path || req.url?.startsWith(`${r.path}?`));
      if (route !== undefined) {
        route.handler(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
      return;
    }

    const mw = middlewares[idx]!;
    mw(req, res, (err?: unknown) => {
      if (err !== undefined) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
        return;
      }
      runMiddlewares(req, res, idx + 1);
    });
  }

  return {
    use(handler: Handler): void {
      middlewares.push(handler);
    },
    get(path: string, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): void {
      routes.push({ path, handler });
    },
    listen(port: number, cb?: () => void): http.Server {
      const server = http.createServer((req, res) => {
        runMiddlewares(req, res, 0);
      });
      server.listen(port, cb);
      return server;
    },
  };
}

// ---------------------------------------------------------------------------
// Application setup
// ---------------------------------------------------------------------------

const app = createApp();

// ─── Chaos middleware ─────────────────────────────────────────────────────
//
// Strategy 1: Use a built-in preset.
// app.use(chaosMiddleware(presets.flakyCafeWifi));
//
// Strategy 2: Use a preset as a base and override specific fields.
app.use(
  chaosMiddleware({
    ...presets.flakyCafeWifi,
    baseDelay: 100,           // slightly faster base than the preset default
    failureRate: 0.08,        // ~8% of requests fail
    failureType: 'random',    // mix of HTTP errors and TCP drops
    excludeRoutes: ['/health', '/ready', '/metrics'],
  }),
);

// ─── Routes ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
});

app.get('/ready', (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ready: true }));
});

app.get('/api/users', (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      users: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    }),
  );
});

app.get('/api/posts', (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      posts: [
        { id: 1, title: 'Hello latency-lab' },
        { id: 2, title: 'Chaos engineering is fun' },
      ],
    }),
  );
});

// ─── Start ───────────────────────────────────────────────────────────────

const PORT = 3000;
app.listen(PORT, () => {
  console.warn(`🌐 Express example running at http://localhost:${PORT}`);
  console.warn('');
  console.warn('Try these endpoints:');
  console.warn(`  curl http://localhost:${PORT}/api/users   → chaos applied`);
  console.warn(`  curl http://localhost:${PORT}/api/posts   → chaos applied`);
  console.warn(`  curl http://localhost:${PORT}/health      → excluded (no chaos)`);
  console.warn('');
  console.warn('Active preset: flakyCafeWifi (modified)');
  console.warn(`  baseDelay:   100 ms`);
  console.warn(`  jitter:      300 ms  (from preset)`);
  console.warn(`  failureRate: 8%`);
  console.warn(`  failureType: random (http-error or tcp-drop)`);
});
