/**
 * Hono middleware adapter for latency-lab.
 */

import {
  decideChaos,
  selectChaosOptionsForPath,
  sleep,
  validateMiddlewareOptions,
} from './core.js';
import type { MiddlewareOptions } from './types.js';

/** Structural subset of HonoRequest used by the adapter. */
export interface HonoRequestLike {
  readonly path: string;
}

/** Structural subset of Hono Context used by the adapter. */
export interface HonoContextLike {
  readonly req: HonoRequestLike;
}

/** Hono-compatible next callback. */
export type HonoNext = () => Promise<void>;

/** Hono-compatible middleware signature. */
export type HonoMiddleware = (
  context: HonoContextLike,
  next: HonoNext,
) => Promise<Response | void>;

function buildErrorResponse(statusCode: number, headers?: HeadersInit): Response {
  const merged = new Headers(headers);
  merged.set('Content-Type', 'application/json');
  merged.set('X-Chaos-Injected', '1');

  return new Response(
    JSON.stringify({
      error: 'Chaos injected error',
      status: statusCode,
    }),
    { status: statusCode, headers: merged },
  );
}

/**
 * Creates Hono middleware with chaos injection.
 *
 * @example
 * app.use('*', honoChaos(presets.slow3g));
 */
export function honoChaos(options: MiddlewareOptions): HonoMiddleware {
  const resolved = validateMiddlewareOptions(options);

  return async (context, next): Promise<Response | void> => {
    const chaos = selectChaosOptionsForPath(context.req.path, resolved);
    if (chaos === null) {
      await next();
      return;
    }

    const decision = decideChaos(chaos);
    await sleep(decision.delay);

    if (decision.outcome === 'tcp-drop') {
      return buildErrorResponse(503, {
        'X-Chaos-Tcp-Drop': '1',
      });
    }

    if (decision.outcome === 'http-error') {
      return buildErrorResponse(decision.statusCode);
    }

    await next();
  };
}
