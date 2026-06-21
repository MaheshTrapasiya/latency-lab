# latency-lab

> TypeScript network latency simulator and HTTP fault-injection toolkit for
> Node.js, browsers, APIs, framework middleware, and zero-code proxy testing.

[![npm version](https://img.shields.io/npm/v/latency-lab.svg)](https://www.npmjs.com/package/latency-lab)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen.svg)](#)

`latency-lab` helps developers test how applications behave under slow,
unreliable, or unavailable networks. It supports outbound Fetch interception,
Express, Next.js, Fastify, and Hono middleware, plus an HTTP/HTTPS reverse proxy
that works with applications written in any language.

Unlike a simple `setTimeout` wrapper, it models real-world degraded network
conditions: sine-wave quality fluctuations, bursty jitter, probabilistic packet
loss, TCP-level connection drops, and HTTP error injection - all composable,
typed, and dependency-free at runtime.

| Goal | Use |
|---|---|
| Degrade outgoing API calls | `createChaosFetch()` or `installFetchChaos()` |
| Test a Node.js server | Express, Next.js, Fastify, or Hono adapter |
| Test without changing application code | `npx latency-lab --target ...` |
| Reproduce realistic network conditions | Built-in presets such as `slow3g` |

---

## Why latency-lab?

| Feature | Simple delay | latency-lab |
|---|---|---|
| Base delay | ✅ | ✅ |
| Random jitter | ❌ | ✅ |
| Wave fluctuations | ❌ | ✅ |
| Packet loss / TCP drop | ❌ | ✅ |
| HTTP error injection | ❌ | ✅ |
| Route exclusions | ❌ | ✅ |
| Typed presets | ❌ | ✅ |
| Zero runtime deps | ✅ | ✅ |

---

## Installation

```bash
npm install --save-dev latency-lab
# or
pnpm add -D latency-lab
# or
yarn add -D latency-lab
```

Peer dependencies (install only what you need):

```bash
# For Express
npm install express

# For Next.js
npm install next

# For Fastify
npm install fastify

# For Hono
npm install hono
```

---

## Quick Start

### Express

```ts
import express from 'express';
import { chaosMiddleware, presets } from 'latency-lab';

const app = express();

// Use a preset
app.use(chaosMiddleware(presets.flakyCafeWifi));

// Or configure manually
app.use(chaosMiddleware({
  baseDelay: 200,
  jitter: 80,
  wavePeriod: 30,
  failureRate: 0.05,
  failureType: 'random',
  errorCodes: [500, 502, 503],
  excludeRoutes: ['/health', '/metrics'],
}));

app.listen(3000);
```

### Next.js App Router

```ts
// app/api/users/route.ts
import { withChaos, presets } from 'latency-lab/next';
import { NextRequest, NextResponse } from 'next/server';

async function GET(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ users: [] });
}

export const GET = withChaos(GET, presets.slow3g);
```

### Fastify

```ts
import Fastify from 'fastify';
import { fastifyChaos, presets } from 'latency-lab/fastify';

const app = Fastify();
app.addHook('onRequest', fastifyChaos(presets.corpVPN));
```

### Hono

```ts
import { Hono } from 'hono';
import { honoChaos, presets } from 'latency-lab/hono';

const app = new Hono();
app.use('*', honoChaos(presets.mobileDataRoaming));
```

### Outbound Fetch

```ts
import { createChaosFetch, presets } from 'latency-lab/fetch';

const degradedFetch = createChaosFetch({
  ...presets.mobileDataRoaming,
  includeUrls: ['https://api.example.com/'],
  excludeUrls: ['https://api.example.com/health'],
});

const response = await degradedFetch('https://api.example.com/users');
```

To intercept global Fetch temporarily:

```ts
import { installFetchChaos, presets } from 'latency-lab/fetch';

const installation = installFetchChaos(presets.flakyCafeWifi);
try {
  await fetch('https://third-party.example.com/data');
} finally {
  installation.restore();
}
```

### Zero-code CLI proxy

```bash
npx latency-lab \
  --target http://localhost:3000 \
  --port 4000 \
  --preset flakyCafeWifi
```

Send requests to `http://127.0.0.1:4000`; the proxy forwards them to the
target after applying chaos. Use `--quiet` to disable per-request logs.

CLI flags override matching environment variables:

```bash
LATENCY_LAB_TARGET=http://localhost:3000
LATENCY_LAB_PORT=4000
LATENCY_LAB_PRESET=slow3g
LATENCY_LAB_FAILURE_RATE=0.1
LATENCY_LAB_EXCLUDE_ROUTES=/health,/metrics
npx latency-lab
```

---

## Common Testing Recipes

### Simulate a third-party API outage

Return synthetic `503` responses for one external service while all other Fetch
requests pass through normally:

```ts
import { createChaosFetch } from 'latency-lab/fetch';

const outageFetch = createChaosFetch({
  baseDelay: 0,
  jitter: 0,
  wavePeriod: 0,
  failureRate: 1,
  failureType: 'http-error',
  errorCodes: [503],
  includeUrls: ['https://payments.example.com/'],
});
```

### Test timeout and retry behavior

Use a deterministic delay with no injected failures:

```ts
import { createChaosFetch } from 'latency-lab/fetch';

const slowFetch = createChaosFetch({
  baseDelay: 2_000,
  jitter: 0,
  wavePeriod: 0,
  failureRate: 0,
  failureType: 'http-error',
  errorCodes: [503],
});
```

Fetch abort signals remain active during the injected delay, so application
timeouts can be tested directly.

### Test any local service without code changes

Put the chaos proxy in front of a Python, Go, Java, Ruby, PHP, or Node.js server:

```bash
npx latency-lab --target http://localhost:3000 --port 4000 --preset slow3g
```

Point tests at `http://127.0.0.1:4000` instead of the original service port.

---

## Presets

Ready-to-use network profiles:

### `presets.subwayTunnel`

Sudden quality drops with intermittent total blackouts. High jitter, moderate loss.

```ts
{
  baseDelay: 800,
  jitter: 600,
  wavePeriod: 8,
  failureRate: 0.20,
  failureType: 'tcp-drop',
  errorCodes: [503, 504],
}
```

### `presets.flakyCafeWifi`

Unpredictable café Wi-Fi — mostly works, occasionally terrible.

```ts
{
  baseDelay: 150,
  jitter: 300,
  wavePeriod: 20,
  failureRate: 0.08,
  failureType: 'random',
  errorCodes: [502, 503, 504],
}
```

### `presets.slow3g`

Classic slow 3G — high latency, low jitter, low failure rate.

```ts
{
  baseDelay: 400,
  jitter: 100,
  wavePeriod: 60,
  failureRate: 0.03,
  failureType: 'http-error',
  errorCodes: [408, 503],
}
```

### `presets.congestedStadium`

Stadium network — extremely variable, high congestion loss.

```ts
{
  baseDelay: 600,
  jitter: 800,
  wavePeriod: 5,
  failureRate: 0.30,
  failureType: 'random',
  errorCodes: [429, 503, 504, 520],
}
```

---

## Express Examples

### Basic setup

```ts
import express from 'express';
import { chaosMiddleware } from 'latency-lab';

const app = express();

app.use(chaosMiddleware({
  baseDelay: 300,
  jitter: 150,
  failureRate: 0.1,
  failureType: 'http-error',
  errorCodes: [500, 503],
}));
```

### Excluding routes

```ts
app.use(chaosMiddleware({
  baseDelay: 200,
  jitter: 50,
  failureRate: 0.05,
  failureType: 'random',
  errorCodes: [503],
  excludeRoutes: ['/health', '/ready', '/_internal'],
}));
```

### Conditional activation

```ts
if (process.env.CHAOS_ENABLED === 'true') {
  app.use(chaosMiddleware(presets.flakyCafeWifi));
}
```

---

## Next.js Examples

### App Router — single route

```ts
// app/api/posts/route.ts
import { withChaos } from 'latency-lab/next';
import { NextRequest, NextResponse } from 'next/server';

async function GET(_req: NextRequest): Promise<NextResponse> {
  const posts = await db.posts.findAll();
  return NextResponse.json(posts);
}

export const GET = withChaos(GET, {
  baseDelay: 300,
  jitter: 100,
  failureRate: 0.05,
  failureType: 'http-error',
  errorCodes: [503],
});
```

### App Router — route exclusions

```ts
export const GET = withChaos(GET, {
  ...presets.slow3g,
  excludeRoutes: ['/api/health'],
});
```

---

## API Reference

### `calculateDelay(options: ChaosOptions): number`

Returns the computed delay in milliseconds for a single request.

The formula is:

```
delay = baseDelay + randomJitter + waveFluctuation
```

- **randomJitter**: uniform random in `[-jitter, +jitter]`
- **waveFluctuation**: `sin(now/1000 * 2π/wavePeriod) * jitter * 0.5` (zero when `wavePeriod` is omitted)
- Final value clamped to `≥ 0`

---

### `shouldFail(options: ChaosOptions): boolean`

Returns `true` with probability equal to `options.failureRate`.

```ts
shouldFail({ failureRate: 0.1, ... }) // ~10% chance
```

---

### `pickErrorCode(options: ChaosOptions): number`

Returns a randomly chosen HTTP status code from `options.errorCodes`.

Throws `ChaosConfigError` if the array is empty.

---

### `resolveFailureType(options: ChaosOptions): ResolvedFailureType`

When `failureType` is `'random'`, randomly picks between `'http-error'` and `'tcp-drop'`. Otherwise returns the configured type.

---

### `decideChaos(options: ChaosOptions): ChaosDecision`

Resolves the delay and final outcome for one request. The result is a
discriminated union with an `outcome` of `'pass'`, `'http-error'`, or
`'tcp-drop'`.

---

### `sleep(ms: number): Promise<void>`

Non-blocking async sleep using `setTimeout`.

---

### `validateChaosOptions(options: unknown): ChaosOptions`

Validates a chaos configuration object. Throws `ChaosConfigError` on invalid input.

---

### `chaosMiddleware(options: MiddlewareOptions): ConnectMiddleware`

Returns an Express/Connect-compatible middleware function.

```ts
import { chaosMiddleware } from 'latency-lab';

app.use(chaosMiddleware({
  baseDelay: 200,
  jitter: 80,
  failureRate: 0.05,
  failureType: 'http-error',
  errorCodes: [503],
  excludeRoutes: ['/health'],
}));
```

---

### `withChaos(handler, options): typeof handler`

Wraps a Next.js App Router handler with chaos injection.

```ts
import { withChaos } from 'latency-lab/next';

export const GET = withChaos(myGetHandler, presets.slow3g);
```

---

### `fastifyChaos(options: MiddlewareOptions): FastifyOnRequestHook`

Creates an async Fastify `onRequest` hook.

```ts
app.addHook('onRequest', fastifyChaos(presets.flakyCafeWifi));
```

---

### `honoChaos(options: MiddlewareOptions): HonoMiddleware`

Creates Hono middleware. TCP drops are represented by a marked 503 response
because edge runtimes do not expose the underlying socket.

```ts
app.use('*', honoChaos(presets.slow3g));
```

---

### `createChaosFetch(options, fetchImpl?): typeof fetch`

Creates a Fetch-compatible wrapper for outbound requests. HTTP failures return
a marked JSON `Response`; TCP drops reject with `ChaosFetchError`.

`includeUrls` and `excludeUrls` accept URL-prefix strings or regular
expressions. All valid URLs are included by default and exclusions take
precedence.

---

### `installFetchChaos(options): FetchChaosInstallation`

Installs Fetch chaos on `globalThis.fetch` and returns an object containing
the installed `fetch` function and an idempotent `restore()` method.

---

### CLI environment variables

| Variable | Purpose |
|---|---|
| `LATENCY_LAB_TARGET` | Required upstream HTTP/HTTPS URL |
| `LATENCY_LAB_HOST` | Listen host, default `127.0.0.1` |
| `LATENCY_LAB_PORT` | Listen port, default `4000` |
| `LATENCY_LAB_PRESET` | Built-in preset name |
| `LATENCY_LAB_BASE_DELAY` | Base delay override |
| `LATENCY_LAB_JITTER` | Jitter override |
| `LATENCY_LAB_WAVE_PERIOD` | Wave period override |
| `LATENCY_LAB_FAILURE_RATE` | Failure probability override |
| `LATENCY_LAB_FAILURE_TYPE` | `http-error`, `tcp-drop`, or `random` |
| `LATENCY_LAB_ERROR_CODES` | Comma-separated status codes |
| `LATENCY_LAB_EXCLUDE_ROUTES` | Comma-separated route prefixes |
| `LATENCY_LAB_QUIET` | `true`/`false` request logging control |

---

### `ChaosOptions`

```ts
interface ChaosOptions {
  /** Base latency in milliseconds. Must be ≥ 0. */
  baseDelay: number;
  /** Maximum jitter added/subtracted from baseDelay. Must be ≥ 0. */
  jitter: number;
  /** Period of the sine-wave fluctuation in seconds. Optional. */
  wavePeriod?: number;
  /** Probability of a failure per request. Range: [0, 1]. */
  failureRate: number;
  /** How failures are expressed. */
  failureType: 'http-error' | 'tcp-drop' | 'random';
  /** Pool of HTTP status codes to pick from on failure. Must be non-empty. */
  errorCodes: number[];
}
```

---

### `MiddlewareOptions`

```ts
interface MiddlewareOptions extends ChaosOptions {
  /** Route path prefixes to exclude from chaos injection. */
  excludeRoutes?: string[];
}
```

---

### `presets`

```ts
import { presets } from 'latency-lab';

presets.subwayTunnel
presets.flakyCafeWifi
presets.slow3g
presets.congestedStadium
presets.satelliteLink
presets.mobileDataRoaming
presets.corpVPN
```

All preset values are `readonly` and fully typed as `ChaosOptions`.

---

## FAQ

**Q: Does this work in production?**

No. `latency-lab` is designed for local development and CI testing. Never use it in production — it intentionally degrades request handling.

**Q: Can I compose multiple presets?**

Yes, using object spread:

```ts
const combined = {
  ...presets.slow3g,
  failureRate: 0.2,
  excludeRoutes: ['/health'],
};
```

**Q: Does it buffer response bodies?**

No. Delay is injected before the request reaches your handler. Response streaming is unaffected.

**Q: What does `tcp-drop` do in HTTP middleware?**

True TCP drops require operating at the socket level and cannot be done cleanly inside HTTP middleware. In `latency-lab`, `tcp-drop` approximates a dropped connection by destroying the socket (`res.socket?.destroy()` in Express, returning a 503 in Next.js). The behavior is documented in each adapter.

**Q: Does it affect WebSocket connections?**

No. It only affects standard HTTP request/response cycles.

---

## Performance Notes

- Zero runtime overhead when `failureRate: 0` and `baseDelay: 0` and `jitter: 0`
- Delay is implemented with `setTimeout` — no busy-waiting, no event loop blocking
- All calculations are synchronous and O(1)
- No memory retained per request
- Safe under high concurrency

---

## Limitations

- TCP drop simulation in Express destroys the underlying socket. Some HTTP clients may retry automatically.
- TCP drop in Next.js returns a 503 response (true socket destruction is not possible in App Router handlers).
- Fetch interception covers the standard Fetch API, including Node's Undici-backed global Fetch, but not direct `undici.request()` calls.
- The CLI proxy supports ordinary HTTP request/response traffic and rejects WebSocket upgrades.
- Wave fluctuation uses wall-clock time (`Date.now()`), which means multiple concurrent requests at the same instant receive similar wave offsets (by design).
- Route exclusion uses prefix matching. Regex patterns are not supported.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local
setup, testing expectations, and pull request guidance. Report vulnerabilities
privately by following [SECURITY.md](SECURITY.md).

---

## License

MIT © Mahesh Trapasiya
