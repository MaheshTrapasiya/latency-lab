# latency-lab

> Test how your app behaves under bad networks without touching infrastructure.

[![npm version](https://img.shields.io/npm/v/latency-lab.svg)](https://www.npmjs.com/package/latency-lab)
[![CI](https://github.com/MaheshTrapasiya/latency-lab/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/MaheshTrapasiya/latency-lab/actions/workflows/npm-publish.yml)
[![Coverage](https://img.shields.io/badge/coverage-100%25%20statements-brightgreen.svg)](https://github.com/MaheshTrapasiya/latency-lab)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/latency-lab)](https://bundlephobia.com/package/latency-lab)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen.svg)](#)

`latency-lab` is a TypeScript network latency simulator and HTTP fault-injection
toolkit for Fetch, Express, Next.js, Fastify, Hono, and zero-code proxy testing.

It helps you test slow APIs, flaky Wi-Fi, third-party outages, retry logic,
timeouts, and degraded mobile networks without touching infrastructure or
adding runtime dependencies.

## Who is this for?

| You are... | Use latency-lab to... |
|---|---|
| A frontend developer | test loading, timeout, retry, and offline UX against degraded APIs |
| A backend developer | test retries, circuit breakers, idempotency, and error handling |
| A QA or CI engineer | run resilience checks against real services before merging |
| A platform team | reproduce network incidents locally without changing infra |
| A library author | verify clients behave correctly under latency and failures |

## Why latency-lab?

Unlike a simple `setTimeout` wrapper, `latency-lab` models real-world degraded
network conditions: base latency, bursty jitter, sine-wave quality changes,
probabilistic packet loss, TCP-style drops, and HTTP error injection.

| Feature | Simple delay | latency-lab |
|---|---:|---:|
| Base delay | Yes | Yes |
| Random jitter | No | Yes |
| Wave fluctuations | No | Yes |
| Packet loss / TCP drop | No | Yes |
| HTTP error injection | No | Yes |
| Route include/exclude filters | No | Yes |
| Per-route chaos config | No | Yes |
| Fetch URL filters | No | Yes |
| Typed presets | No | Yes |
| Zero runtime dependencies | Yes | Yes |

## Installation

```bash
npm install --save-dev latency-lab
# or
pnpm add -D latency-lab
# or
yarn add -D latency-lab
```

Requirements:

- Node.js 18 or newer.
- TypeScript users should use `moduleResolution: "Bundler"`, `"Node16"`, or
  `"NodeNext"` for subpath imports such as `latency-lab/fetch` and
  `latency-lab/fastify`.
- Browser-facing Fetch helpers do not import Node.js modules.

Peer dependencies are optional. Install only the framework adapter you use:

```bash
npm install express
npm install next
npm install fastify
npm install hono
```

## Quick Start

### Express

```ts
import express from 'express';
import { chaosMiddleware, presets } from 'latency-lab';

const app = express();

app.use(chaosMiddleware({
  ...presets.flakyCafeWifi,
  includeRoutes: ['/api'],
  excludeRoutes: ['/health', '/metrics'],
  routes: [
    { match: '/api/payments', chaos: presets.subwayTunnel },
    { match: '/api/public', chaos: false },
  ],
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

Hono can run on edge runtimes where true socket destruction is unavailable. In
that case `tcp-drop` is represented as a marked `503` response instead of a real
connection reset.

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

Send requests to `http://127.0.0.1:4000`; the proxy forwards them to the target
after applying chaos. Use `--quiet` to disable per-request logs.

CLI flags override matching environment variables:

```bash
LATENCY_LAB_TARGET=http://localhost:3000
LATENCY_LAB_PORT=4000
LATENCY_LAB_PRESET=slow3g
LATENCY_LAB_FAILURE_RATE=0.1
LATENCY_LAB_INCLUDE_ROUTES=/api
LATENCY_LAB_EXCLUDE_ROUTES=/health,/metrics
npx latency-lab
```

## Common Testing Recipes

### Simulate a third-party API outage

Return synthetic `503` responses for one external service while all other Fetch
requests pass through normally:

```ts
import { createChaosFetch } from 'latency-lab/fetch';

const outageFetch = createChaosFetch({
  baseDelay: 0,
  jitter: 0,
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
  failureRate: 0,
  failureType: 'http-error',
  errorCodes: [503],
});
```

Fetch abort signals remain active during the injected delay, so application
timeouts can be tested directly.

### Use Fetch chaos in Vitest

```ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { installFetchChaos, presets } from 'latency-lab/fetch';

let chaos: ReturnType<typeof installFetchChaos>;

beforeEach(() => {
  chaos = installFetchChaos({
    ...presets.flakyCafeWifi,
    includeUrls: ['https://api.example.com/'],
  });
});

afterEach(() => {
  chaos.restore();
});

test('shows a retry state when the API is slow', async () => {
  const response = await fetch('https://api.example.com/users');
  expect(response).toBeDefined();
});
```

For Jest, use the same `installFetchChaos()` and `restore()` pattern in
`beforeEach` and `afterEach`.

### Test any local service without code changes

Put the chaos proxy in front of a Python, Go, Java, Ruby, PHP, or Node.js server:

```bash
npx latency-lab --target http://localhost:3000 --port 4000 --preset slow3g
```

Point tests at `http://127.0.0.1:4000` instead of the original service port.

### Keep snapshot and timing tests stable

`wavePeriod` uses wall-clock time. For deterministic tests, omit `wavePeriod`
and set `jitter: 0` when you need a fixed delay.

### Apply chaos only to selected routes

Use `includeRoutes` when you want health checks and static assets to stay fast
while API routes degrade:

```ts
app.use(chaosMiddleware({
  ...presets.slow3g,
  includeRoutes: ['/api'],
  excludeRoutes: ['/api/health'],
}));
```

For different behavior per path, use `routes`. Entries are checked in order
after `excludeRoutes`; `chaos: false` bypasses a route explicitly.

```ts
app.use(chaosMiddleware({
  ...presets.flakyCafeWifi,
  routes: [
    { match: '/api/payments', chaos: presets.subwayTunnel },
    { match: /^\/api\/search(?:\/|$)/, chaos: presets.congestedStadium },
    { match: '/api/health', chaos: false },
  ],
}));
```

## Presets

Ready-to-use network profiles:

### `presets.subwayTunnel`

Sudden quality drops with intermittent blackouts. Useful for testing hard
disconnects and mobile clients moving through poor coverage.

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

Unpredictable cafe Wi-Fi: mostly usable, with occasional bursts of bad latency
and mixed failure types.

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

Classic slow 3G: high latency, low jitter, and low failure rate. Good for
testing loading states and timeout thresholds.

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

Event venue congestion: extremely variable latency, rapid quality swings, and
frequent failures.

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

### `presets.satelliteLink`

Stable but inherently high-latency satellite internet. Useful for testing apps
that assume low round-trip time.

```ts
{
  baseDelay: 600,
  jitter: 50,
  wavePeriod: 120,
  failureRate: 0.01,
  failureType: 'http-error',
  errorCodes: [408, 504],
}
```

### `presets.mobileDataRoaming`

International roaming: medium base latency with random bursts and mixed HTTP or
TCP-style failures.

```ts
{
  baseDelay: 250,
  jitter: 350,
  wavePeriod: 15,
  failureRate: 0.08,
  failureType: 'random',
  errorCodes: [408, 429, 502, 503, 504],
}
```

### `presets.corpVPN`

Corporate VPN conditions: moderate consistent latency with occasional abrupt
connection loss.

```ts
{
  baseDelay: 120,
  jitter: 80,
  wavePeriod: 45,
  failureRate: 0.03,
  failureType: 'tcp-drop',
  errorCodes: [502, 503, 504],
}
```

## Core API

Most applications only need one of these entry points:

| API | Import from | Use it for |
|---|---|---|
| `chaosMiddleware()` | `latency-lab` or `latency-lab/express` | Express and Connect-compatible servers |
| `withChaos()` | `latency-lab/next` | Next.js App Router handlers |
| `fastifyChaos()` | `latency-lab/fastify` | Fastify `onRequest` hooks |
| `honoChaos()` | `latency-lab/hono` | Hono middleware, including edge-style runtimes |
| `createChaosFetch()` | `latency-lab/fetch` | Outbound Fetch calls without touching global state |
| `installFetchChaos()` | `latency-lab/fetch` | Test setup that temporarily intercepts `globalThis.fetch` |
| `npx latency-lab` | package binary | Proxy any HTTP service without code changes |

See the full [API reference](docs/api.md) for core helpers, types, CLI
environment variables, and adapter details.

## Route Targeting

Framework middleware and the CLI proxy support route-level targeting:

```ts
import { presets, type ChaosScenario } from 'latency-lab';

const checkoutChaos: ChaosScenario = {
  name: 'checkout-resilience',
  description: 'Stress checkout dependencies without slowing health checks',
  chaos: presets.flakyCafeWifi,
  includeRoutes: ['/api'],
  excludeRoutes: ['/api/health'],
  routes: [
    { match: '/api/payments', chaos: presets.subwayTunnel },
    { match: '/api/catalog', chaos: false },
  ],
};
```

String route matchers use prefix matching. Programmatic APIs also accept regular
expressions. `excludeRoutes` always wins, then `routes`, then `includeRoutes`,
then the default chaos options.

## TypeScript Notes

`latency-lab` ships ESM, CommonJS, and declaration files for every subpath
export:

```ts
import { chaosMiddleware } from 'latency-lab';
import { createChaosFetch } from 'latency-lab/fetch';
import { fastifyChaos } from 'latency-lab/fastify';
```

If TypeScript cannot resolve a subpath import, set `moduleResolution` to
`"Bundler"`, `"Node16"`, or `"NodeNext"`. Node.js 18 or newer is required
because Fetch support depends on the standard global Fetch API.

## FAQ

**Q: Can I compose multiple presets?**

Yes, use object spread:

```ts
const combined = {
  ...presets.slow3g,
  failureRate: 0.2,
  excludeRoutes: ['/health'],
};
```

**Q: Does it buffer response bodies?**

No. Delay is injected before the request reaches your handler. Response
streaming is unaffected.

**Q: What does `tcp-drop` do in HTTP middleware?**

Express destroys the underlying socket when possible. Next.js and Hono return a
marked `503` response where true socket destruction is not available.

**Q: Does it affect WebSocket connections?**

No. It only affects standard HTTP request/response cycles. The CLI proxy rejects
WebSocket upgrades.

**Q: Is this safe to deploy?**

`latency-lab` is designed for local development and CI testing. Do not enable it
in production paths unless you are intentionally running a controlled resilience
experiment.

## Performance Notes

- Zero runtime overhead when `failureRate: 0`, `baseDelay: 0`, and `jitter: 0`.
- Delay is implemented with `setTimeout`; there is no busy-waiting.
- All calculations are synchronous and O(1).
- No request state is retained after completion.
- Safe under high test concurrency.

## Limitations

- TCP drop simulation in Express destroys the underlying socket. Some HTTP
  clients may retry automatically.
- TCP drop in Next.js and Hono returns a marked `503` response where the runtime
  does not expose the socket.
- Fetch interception covers the standard Fetch API, including Node's
  Undici-backed global Fetch, but not direct `undici.request()` calls.
- The CLI proxy supports ordinary HTTP request/response traffic and rejects
  WebSocket upgrades.
- Wave fluctuation uses wall-clock time (`Date.now()`), which can make
  time-sensitive tests appear variable unless `wavePeriod` is disabled.
- String route matchers use prefix matching. Regular expressions are supported
  in programmatic route filters, but CLI route filters are string prefixes.

## Project Links

- [GitHub repository](https://github.com/MaheshTrapasiya/latency-lab)
- [Issues](https://github.com/MaheshTrapasiya/latency-lab/issues)
- [Changelog](CHANGELOG.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local
setup, testing expectations, and pull request guidance. Report vulnerabilities
privately by following [SECURITY.md](SECURITY.md).

## License

MIT (c) Mahesh Trapasiya
