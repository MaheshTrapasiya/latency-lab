/**
 * Fastify onRequest hook adapter for latency-lab.
 */

import type { IncomingMessage } from 'node:http';
import { decideChaos, isExcluded, sleep, validateChaosOptions } from './core.js';
import type { MiddlewareOptions } from './types.js';

/** Structural subset of FastifyRequest used by the adapter. */
export interface FastifyRequestLike {
  readonly url: string;
  readonly raw: IncomingMessage;
}

/** Structural subset of FastifyReply used by the adapter. */
export interface FastifyReplyLike {
  code(statusCode: number): FastifyReplyLike;
  header(name: string, value: string): FastifyReplyLike;
  send(payload: unknown): unknown;
}

/** Fastify-compatible async onRequest hook. */
export type FastifyOnRequestHook = (
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
) => Promise<void>;

/**
 * Creates a Fastify onRequest hook with chaos injection.
 *
 * @example
 * app.addHook('onRequest', fastifyChaos(presets.flakyCafeWifi));
 */
export function fastifyChaos(options: MiddlewareOptions): FastifyOnRequestHook {
  const validated = validateChaosOptions(options);
  const excludeRoutes: readonly string[] = options.excludeRoutes ?? [];

  return async (request, reply): Promise<void> => {
    if (
      excludeRoutes.length > 0 &&
      isExcluded(request.url, excludeRoutes)
    ) {
      return;
    }

    const decision = decideChaos(validated);
    await sleep(decision.delay);

    if (decision.outcome === 'tcp-drop') {
      if (!request.raw.socket.destroyed) {
        request.raw.socket.destroy();
      }
      return;
    }

    if (decision.outcome === 'http-error') {
      reply
        .code(decision.statusCode)
        .header('Content-Type', 'application/json')
        .header('X-Chaos-Injected', '1')
        .send({
          error: 'Chaos injected error',
          status: decision.statusCode,
        });
    }
  };
}
