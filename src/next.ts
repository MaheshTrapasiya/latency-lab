/**
 * Next.js App Router adapter for latency-lab.
 *
 * Wraps App Router route handlers (`GET`, `POST`, etc.) with chaos injection.
 *
 * **TCP drop limitation:**
 * App Router handlers run in a higher-level abstraction — the raw socket is
 * not accessible inside a route handler. `tcp-drop` is therefore approximated
 * by returning a 503 response with an `X-Chaos-Tcp-Drop: 1` header so callers
 * can distinguish it from a real 503 during testing.
 *
 * Usage:
 * ```ts
 * // app/api/users/route.ts
 * import { withChaos, presets } from 'latency-lab/next';
 * import { NextRequest, NextResponse } from 'next/server';
 *
 * async function GET(_req: NextRequest): Promise<NextResponse> {
 *   return NextResponse.json({ users: [] });
 * }
 *
 * export const GET = withChaos(GET, presets.slow3g);
 * ```
 */

import type { MiddlewareOptions } from './types.js';
import {
  calculateDelay,
  isExcluded,
  pickErrorCode,
  resolveFailureType,
  shouldFail,
  sleep,
  validateChaosOptions,
} from './core.js';

// ---------------------------------------------------------------------------
// Minimal Next.js type stubs
//
// We deliberately avoid importing from 'next/server' so that `next` remains
// a peer dependency. The shapes below are structurally compatible with the
// real `NextRequest` / `NextResponse` from Next.js 14 and 15.
// ---------------------------------------------------------------------------

/**
 * Structural subset of `NextRequest` used internally.
 * Fully compatible with the real `NextRequest` from `next/server`.
 */
export interface NextRequestLike {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
}

/**
 * Structural subset of `NextResponse` used internally.
 * Fully compatible with the real `NextResponse` from `next/server`.
 */
export interface NextResponseLike extends Response {
  readonly status: number;
  readonly headers: Headers;
}

/**
 * A Next.js App Router route handler.
 *
 * The generic `Req` and `Res` parameters let callers use the real
 * `NextRequest` / `NextResponse` types without this library depending on them.
 */
export type NextRouteHandler<
  Req extends NextRequestLike = NextRequestLike,
  Res extends NextResponseLike = NextResponseLike,
> = (req: Req, ctx?: unknown) => Promise<Res>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal JSON error Response compatible with `NextResponse.json()`.
 *
 * We construct a plain `Response` instead of calling `NextResponse.json()` to
 * avoid importing from `next/server` at runtime.
 */
function buildErrorResponse(statusCode: number, headers?: HeadersInit): Response {
  const body = JSON.stringify({
    error: 'Chaos injected error',
    status: statusCode,
  });
  const merged = new Headers(headers);
  merged.set('Content-Type', 'application/json');
  merged.set('X-Chaos-Injected', '1');
  return new Response(body, { status: statusCode, headers: merged });
}

/**
 * Extracts the pathname from a URL string.
 * Falls back to the full string if parsing fails (non-standard environments).
 */
function pathnameFrom(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    // If the URL is relative or malformed, treat the whole value as the path
    const questionMark = url.indexOf('?');
    return questionMark === -1 ? url : url.slice(0, questionMark);
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Wraps a Next.js App Router route handler with chaos injection.
 *
 * The returned handler has the same signature as the original, so it can be
 * re-exported directly:
 *
 * ```ts
 * export const GET = withChaos(myHandler, presets.flakyCafeWifi);
 * ```
 *
 * Behaviour:
 * 1. Routes matching `excludeRoutes` are passed through immediately.
 * 2. A realistic delay is injected via `sleep()`.
 * 3. When a failure is triggered:
 *    - `'http-error'` → returns a Response with a status from `errorCodes`
 *    - `'tcp-drop'`   → returns a 503 with `X-Chaos-Tcp-Drop: 1` (limitation noted above)
 * 4. Otherwise, the original handler is called and its response is returned.
 *
 * @param handler - The original App Router route handler.
 * @param options - Chaos configuration. Validated eagerly.
 * @returns A wrapped handler with the same signature.
 */
export function withChaos<
  Req extends NextRequestLike,
  Res extends NextResponseLike,
>(
  handler: NextRouteHandler<Req, Res>,
  options: MiddlewareOptions,
): NextRouteHandler<Req, Res> {
  // Validate at wrap time so misconfiguration fails fast at module load,
  // not on the first incoming request.
  const validated = validateChaosOptions(options);
  const excludeRoutes: readonly string[] = options.excludeRoutes ?? [];

  return async (req: Req, ctx?: unknown): Promise<Res> => {
    const pathname = pathnameFrom(req.url);

    // --- Route exclusion ---------------------------------------------------
    if (excludeRoutes.length > 0 && isExcluded(pathname, excludeRoutes)) {
      return handler(req, ctx);
    }

    // --- Delay injection ---------------------------------------------------
    const delay = calculateDelay(validated);
    await sleep(delay);

    // --- Failure injection -------------------------------------------------
    if (shouldFail(validated)) {
      const failureType = resolveFailureType(validated);

      if (failureType === 'tcp-drop') {
        // True TCP drop is not possible inside an App Router handler.
        // We approximate it with a 503 and a marker header so test suites
        // can detect the simulated drop.
        return buildErrorResponse(503, {
          'X-Chaos-Tcp-Drop': '1',
        }) as unknown as Res;
      }

      // failureType === 'http-error'
      const statusCode = pickErrorCode(validated);
      return buildErrorResponse(statusCode) as unknown as Res;
    }

    // --- Delegate to original handler -------------------------------------
    return handler(req, ctx);
  };
}
