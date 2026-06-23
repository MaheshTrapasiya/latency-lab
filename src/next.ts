/**
 * Next.js App Router adapter for latency-lab.
 */

import {
  decideChaos,
  selectChaosOptionsForPath,
  sleep,
  validateMiddlewareOptions,
} from './core.js';
import type { MiddlewareOptions } from './types.js';

/** Structural subset of NextRequest used by the adapter. */
export interface NextRequestLike {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
}

/** Structural subset of NextResponse used by the adapter. */
export interface NextResponseLike extends Response {
  readonly status: number;
  readonly headers: Headers;
}

/** Next.js App Router route handler signature. */
export type NextRouteHandler<
  Req extends NextRequestLike = NextRequestLike,
  Res extends NextResponseLike = NextResponseLike,
> = (req: Req, ctx?: unknown) => Promise<Res>;

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

function pathnameFrom(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    const questionMark = url.indexOf('?');
    return questionMark === -1 ? url : url.slice(0, questionMark);
  }
}

/**
 * Wraps a Next.js App Router route handler with chaos injection.
 */
export function withChaos<
  Req extends NextRequestLike,
  Res extends NextResponseLike,
>(
  handler: NextRouteHandler<Req, Res>,
  options: MiddlewareOptions,
): NextRouteHandler<Req, Res> {
  const resolved = validateMiddlewareOptions(options);

  return async (req: Req, ctx?: unknown): Promise<Res> => {
    const pathname = pathnameFrom(req.url);
    const chaos = selectChaosOptionsForPath(pathname, resolved);
    if (chaos === null) {
      return handler(req, ctx);
    }

    const decision = decideChaos(chaos);
    await sleep(decision.delay);

    if (decision.outcome === 'tcp-drop') {
      return buildErrorResponse(503, {
        'X-Chaos-Tcp-Drop': '1',
      }) as unknown as Res;
    }

    if (decision.outcome === 'http-error') {
      return buildErrorResponse(decision.statusCode) as unknown as Res;
    }

    return handler(req, ctx);
  };
}
