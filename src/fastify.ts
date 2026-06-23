/**
 * Fastify onRequest hook adapter for latency-lab.
 */

import type { IncomingMessage } from 'node:http';
import {
  decideChaos,
  selectChaosOptionsForPath,
  sleep,
  validateMiddlewareOptions,
} from './core.js';
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
  const resolved = validateMiddlewareOptions(options);

  return async (request, reply): Promise<void> => {
    const chaos = selectChaosOptionsForPath(request.url, resolved);
    if (chaos === null) {
      return;
    }

    const decision = decideChaos(chaos);
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
