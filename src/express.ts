/**
 * Express / Connect adapter for latency-lab.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { decideChaos, isExcluded, sleep, validateChaosOptions } from './core.js';
import type { MiddlewareOptions } from './types.js';

/** Minimal Connect-compatible middleware signature. */
export type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

type DestroyableSocket = Socket & { destroyed: boolean };

function dropTcpConnection(res: ServerResponse): void {
  const socket = res.socket as DestroyableSocket | null;
  if (socket !== null && !socket.destroyed) {
    socket.destroy();
  }
}

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

/**
 * Creates a Connect/Express-compatible chaos middleware.
 */
export function chaosMiddleware(options: MiddlewareOptions): ConnectMiddleware {
  const validated = validateChaosOptions(options);
  const excludeRoutes: readonly string[] = options.excludeRoutes ?? [];

  return (req, res, next): void => {
    (async (): Promise<void> => {
      const pathname = req.url ?? '/';
      if (excludeRoutes.length > 0 && isExcluded(pathname, excludeRoutes)) {
        next();
        return;
      }

      const decision = decideChaos(validated);
      await sleep(decision.delay);

      if (decision.outcome === 'tcp-drop') {
        dropTcpConnection(res);
        return;
      }

      if (decision.outcome === 'http-error') {
        sendHttpError(res, decision.statusCode);
        return;
      }

      next();
    })().catch((error: unknown) => {
      next(error);
    });
  };
}
