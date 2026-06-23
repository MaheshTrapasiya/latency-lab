# latency-lab API Reference

This page keeps the detailed API surface out of the README while preserving the
full reference for users who want exact helper, adapter, and type details.

## Core Chaos Engine

### `calculateDelay(options: ChaosOptions): number`

Returns the computed delay in milliseconds for one request.

```txt
delay = baseDelay + randomJitter + waveFluctuation
```

- `randomJitter`: uniform random value in `[-jitter, +jitter]`.
- `waveFluctuation`: `sin(now / 1000 * 2 * PI / wavePeriod) * jitter * 0.5`.
- `waveFluctuation` is zero when `wavePeriod` is omitted.
- Final delay is clamped to `>= 0`.

`wavePeriod` uses wall-clock time through `Date.now()`. For deterministic tests,
omit it before passing options.

### `shouldFail(options: ChaosOptions): boolean`

Returns `true` with probability equal to `options.failureRate`.

```ts
shouldFail({ failureRate: 0.1, /* ... */ }); // about 10% chance
```

### `pickErrorCode(options: ChaosOptions): number`

Returns a randomly chosen HTTP status code from `options.errorCodes`.

Throws `ChaosConfigError` if the array is empty.

### `resolveFailureType(options: ChaosOptions): ResolvedFailureType`

When `failureType` is `'random'`, randomly picks between `'http-error'` and
`'tcp-drop'`. Otherwise returns the configured concrete failure type.

### `decideChaos(options: ChaosOptions): ChaosDecision`

Resolves the delay and final outcome for one request. The result is a
discriminated union with an `outcome` of `'pass'`, `'http-error'`, or
`'tcp-drop'`.

```ts
type ChaosDecision =
  | { outcome: 'pass'; delay: number }
  | { outcome: 'http-error'; delay: number; statusCode: number }
  | { outcome: 'tcp-drop'; delay: number };
```

### `sleep(ms: number): Promise<void>`

Non-blocking async sleep using `setTimeout`.

### `validateChaosOptions(options: unknown): ChaosOptions`

Validates a chaos configuration object. Throws `ChaosConfigError` on invalid
input.

## Framework Adapters

### `chaosMiddleware(options: MiddlewareOptions): ConnectMiddleware`

Returns an Express/Connect-compatible middleware function.

```ts
import { chaosMiddleware, presets } from 'latency-lab';

app.use(chaosMiddleware({
  baseDelay: 200,
  jitter: 80,
  failureRate: 0.05,
  failureType: 'http-error',
  errorCodes: [503],
  includeRoutes: ['/api'],
  excludeRoutes: ['/health'],
  routes: [
    { match: '/api/payments', chaos: presets.subwayTunnel },
    { match: '/api/public', chaos: false },
  ],
}));
```

### `withChaos(handler, options): typeof handler`

Wraps a Next.js App Router handler with chaos injection.

```ts
import { withChaos, presets } from 'latency-lab/next';

export const GET = withChaos(myGetHandler, presets.slow3g);
```

### `fastifyChaos(options: MiddlewareOptions): FastifyOnRequestHook`

Creates an async Fastify `onRequest` hook.

```ts
import { fastifyChaos, presets } from 'latency-lab/fastify';

app.addHook('onRequest', fastifyChaos(presets.flakyCafeWifi));
```

### `honoChaos(options: MiddlewareOptions): HonoMiddleware`

Creates Hono middleware. TCP drops are represented by a marked `503` response
because edge runtimes do not expose the underlying socket.

```ts
import { honoChaos, presets } from 'latency-lab/hono';

app.use('*', honoChaos(presets.slow3g));
```

## Fetch

### `createChaosFetch(options, fetchImpl?): typeof fetch`

Creates a Fetch-compatible wrapper for outbound requests. HTTP failures return a
marked JSON `Response`; TCP drops reject with `ChaosFetchError`.

```ts
import { createChaosFetch, presets } from 'latency-lab/fetch';

const chaosFetch = createChaosFetch({
  ...presets.flakyCafeWifi,
  includeUrls: ['https://api.example.com/'],
  excludeUrls: ['https://api.example.com/health'],
});
```

`includeUrls` and `excludeUrls` accept URL-prefix strings or regular
expressions. All valid URLs are included by default and exclusions take
precedence.

The wrapper accepts the normal Fetch inputs: URL strings, `URL` objects, and
`Request` objects. Request abort signals are respected during injected delays.

### `installFetchChaos(options): FetchChaosInstallation`

Installs Fetch chaos on `globalThis.fetch` and returns an object containing the
installed `fetch` function and an idempotent `restore()` method.

```ts
import { installFetchChaos, presets } from 'latency-lab/fetch';

const installation = installFetchChaos(presets.slow3g);

try {
  await fetch('https://api.example.com/users');
} finally {
  installation.restore();
}
```

Nested installations restore safely. If a newer installation has replaced the
global Fetch, restoring an older installation will not overwrite it.

### `ChaosFetchError`

Thrown when Fetch chaos resolves to a TCP-drop outcome.

```ts
try {
  await chaosFetch('https://api.example.com/users');
} catch (error) {
  if (error instanceof ChaosFetchError) {
    console.log(error.code); // ERR_CHAOS_TCP_DROP
  }
}
```

## CLI Proxy

Run an HTTP reverse proxy that applies chaos before forwarding requests:

```bash
npx latency-lab --target http://localhost:3000 --port 4000 --preset slow3g
```

Defaults:

- Host: `127.0.0.1`
- Port: `4000`
- Target: required through `--target` or `LATENCY_LAB_TARGET`
- Logging: enabled unless `--quiet` or `LATENCY_LAB_QUIET=true` is set

The proxy supports HTTP and HTTPS upstream targets, request bodies, response
streaming, headers, status codes, and query strings. It rewrites host and
forwarding headers before sending the upstream request.

### CLI Flags

| Flag | Purpose |
|---|---|
| `--target <url>` | Required upstream HTTP/HTTPS URL |
| `--host <host>` | Listen host, default `127.0.0.1` |
| `--port <port>` | Listen port, default `4000` |
| `--preset <name>` | Built-in preset name |
| `--delay <ms>` | Base delay override |
| `--jitter <ms>` | Jitter override |
| `--wave-period <seconds>` | Wave period override |
| `--failure-rate <rate>` | Failure probability override |
| `--failure-type <type>` | `http-error`, `tcp-drop`, or `random` |
| `--error-codes <codes>` | Comma-separated status codes |
| `--include-route <path>` | Route prefix to target; repeatable |
| `--exclude-route <path>` | Route prefix to bypass; repeatable |
| `--quiet` | Disable request logging |
| `--help` | Print usage |
| `--version` | Print package version |

### CLI Environment Variables

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
| `LATENCY_LAB_INCLUDE_ROUTES` | Comma-separated route prefixes to target |
| `LATENCY_LAB_EXCLUDE_ROUTES` | Comma-separated route prefixes |
| `LATENCY_LAB_QUIET` | `true`/`false` request logging control |

Precedence is CLI flags, environment variables, preset values, then CLI
defaults.

## Types

### `ChaosOptions`

```ts
interface ChaosOptions {
  /** Base latency in milliseconds. Must be >= 0. */
  baseDelay: number;

  /** Maximum jitter added/subtracted from baseDelay. Must be >= 0. */
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

### `MiddlewareOptions`

```ts
type RouteMatcher = string | RegExp;

interface MiddlewareOptions extends ChaosOptions {
  /** Route path prefixes or regular expressions to target. */
  includeRoutes?: RouteMatcher[];

  /** Route path prefixes or regular expressions to bypass. */
  excludeRoutes?: RouteMatcher[];

  /** Per-route overrides checked before the default chaos options. */
  routes?: RouteChaosConfig[];
}
```

String route matchers use prefix matching. Regular expressions are reset before
each match, so global regex instances are safe to reuse. `excludeRoutes` always
wins, then `routes`, then `includeRoutes`, then the default chaos options.

### `RouteChaosConfig`

```ts
interface RouteChaosConfig {
  match: RouteMatcher;
  chaos: ChaosOptions | false;
}
```

Use `chaos: false` to bypass a route explicitly:

```ts
chaosMiddleware({
  ...presets.flakyCafeWifi,
  routes: [
    { match: '/api/payments', chaos: presets.subwayTunnel },
    { match: /^\/api\/public(?:\/|$)/, chaos: false },
  ],
});
```

### `ChaosScenario`

```ts
interface ChaosScenario {
  name: string;
  description?: string;
  chaos: ChaosOptions;
  includeRoutes?: RouteMatcher[];
  excludeRoutes?: RouteMatcher[];
  routes?: RouteChaosConfig[];
}
```

`ChaosScenario` is a typed shape for team-shared config files. It is exported
from the package root and `latency-lab/types`; runtime config loading is left to
your application for now.

### `FetchChaosOptions`

```ts
type UrlMatcher = string | RegExp;

interface FetchChaosOptions extends ChaosOptions {
  includeUrls?: UrlMatcher[];
  excludeUrls?: UrlMatcher[];
}
```

### `FailureType`

```ts
type FailureType = 'http-error' | 'tcp-drop' | 'random';
```

### `ResolvedFailureType`

```ts
type ResolvedFailureType = 'http-error' | 'tcp-drop';
```

## Presets

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

All preset values are `readonly` and typed as `ChaosOptions`. Spread a preset to
customize it:

```ts
const paymentsChaos = {
  ...presets.slow3g,
  failureRate: 0.15,
  excludeRoutes: ['/health'],
};
```

## Subpath Exports

```ts
import { chaosMiddleware } from 'latency-lab';
import { decideChaos } from 'latency-lab/core';
import { createChaosFetch } from 'latency-lab/fetch';
import { fastifyChaos } from 'latency-lab/fastify';
import { honoChaos } from 'latency-lab/hono';
import { withChaos } from 'latency-lab/next';
import { presets } from 'latency-lab/presets';
```

Use TypeScript `moduleResolution: "Bundler"`, `"Node16"`, or `"NodeNext"` if
your project imports package subpaths.
