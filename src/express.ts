/**
 * Express / Connect adapter for latency-lab.
 *
 * This module introduces zero runtime dependencies on Express. Types are
 * inlined so that `express` remains a peer / optional dependency — the
 * middleware works with any framework that honours the Connect signature:
 *
 *   (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void
 *
 * Usage:
 * ```ts
 * import express from 'express';
 * import { chaosMiddleware, presets } from 'latency-lab';
 *
 * const app = express();
 * app.use(chaosMiddleware(presets.flakyCafeWifi));
 * ```
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
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
// Internal types
// ---------------------------------------------------------------------------

/**
 * Minimal Connect-compatible middleware signature.
 * Compatible with Express 4/5 and raw `node:http` middleware stacks.
 */
export type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/**
 * Shape of a socket that optionally exposes `.destroy()`.
 * We avoid importing from `node:net` at the call-site to stay tree-shakeable.
 */
type DestroyableSocket = Socket & { destroyed: boolean };

// ---------------------------------------------------------------------------
// Helper — TCP drop approximation
// ---------------------------------------------------------------------------

/**
 * Approximates a TCP connection drop by destroying the underlying socket.
 *
 * **Limitations:**
 * - Calling `socket.destroy()` sends a TCP RST to the peer.
 * - Some HTTP clients (including Node's own `http.request`) will surface this
 *   as an `ECONNRESET` error and may retry automatically.
 * - HTTP/2 connections share a multiplexed socket — destroying it affects all
 *   streams, not just the current request.
 */
function dropTcpConnection(res: ServerResponse): void {
  const socket = res.socket as DestroyableSocket | null;
  if (socket !== null && !socket.destroyed) {
    socket.destroy();
  }
}

// ---------------------------------------------------------------------------
// Helper — send HTTP error
// ---------------------------------------------------------------------------

function sendHttpError(res: ServerResponse, statusCode: number): void {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'X-Chaos-Injected': '1',
  });
  res.end(
    JSON.stringify({
      error: 'Chaos injected error',
      status: statusCode,
    }),
  );
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Creates a Connect/Express-compatible chaos middleware.
 *
 * The middleware:
 * 1. Skips excluded routes immediately (calls `next()`).
 * 2. Calculates a realistic delay and `await`s it.
 * 3. Optionally injects a failure (HTTP error or TCP drop).
 * 4. Calls `next()` to hand off to the application for normal requests.
 *
 * @param options - Chaos configuration. Validated eagerly at factory time.
 * @returns A Connect-compatible middleware function.
 *
 * @example
 * ```ts
 * app.use(chaosMiddleware({
 *   baseDelay: 200,
 *   jitter: 80,
 *   failureRate: 0.05,
 *   failureType: 'http-error',
 *   errorCodes: [503],
 *   excludeRoutes: ['/health'],
 * }));
 * ```
 */
export function chaosMiddleware(options: MiddlewareOptions): ConnectMiddleware {
  // Validate at factory time so misconfiguration surfaces immediately on
  // startup rather than on the first request.
  const validated = validateChaosOptions(options);
  const excludeRoutes: readonly string[] = options.excludeRoutes ?? [];

  const middleware: ConnectMiddleware = (req, res, next) => {
    // Async work is wrapped in an IIFE so the middleware signature stays
    // synchronous (required by Connect) while still using async/await internally.
    (async () => {
      const pathname = req.url ?? '/';

      // --- Route exclusion -------------------------------------------------
      if (excludeRoutes.length > 0 && isExcluded(pathname, excludeRoutes)) {
        next();
        return;
      }

      // --- Delay injection -------------------------------------------------
      const delay = calculateDelay(validated);
      await sleep(delay);

      // --- Failure injection -----------------------------------------------
      if (shouldFail(validated)) {
        const failureType = resolveFailureType(validated);

        if (failureType === 'tcp-drop') {
          dropTcpConnection(res);
          return; // do NOT call next() — connection is gone
        }

        // failureType === 'http-error'
        const statusCode = pickErrorCode(validated);
        sendHttpError(res, statusCode);
        return; // do NOT call next() — response already sent
      }

      // --- Pass through to application -------------------------------------
      next();
    })().catch((err: unknown) => {
      // Surface unexpected errors to Express's error handler
      next(err);
    });
  };

  return middleware;
}
