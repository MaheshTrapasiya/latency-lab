import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  fastifyChaos,
  type FastifyReplyLike,
  type FastifyRequestLike,
} from '../src/fastify.js';
import {
  honoChaos,
  type HonoContextLike,
} from '../src/hono.js';
import { ChaosConfigError } from '../src/types.js';
import type { MiddlewareOptions } from '../src/types.js';

const passOptions: MiddlewareOptions = {
  baseDelay: 0,
  jitter: 0,
  failureRate: 0,
  failureType: 'http-error',
  errorCodes: [503],
};

const httpFailureOptions: MiddlewareOptions = {
  ...passOptions,
  failureRate: 1,
};

const tcpFailureOptions: MiddlewareOptions = {
  ...httpFailureOptions,
  failureType: 'tcp-drop',
};

function fastifyRequest(
  url = '/api/test',
): FastifyRequestLike & { socketDestroyed: () => boolean } {
  let destroyed = false;
  const raw = {
    socket: {
      get destroyed(): boolean {
        return destroyed;
      },
      destroy(): void {
        destroyed = true;
      },
    },
  } as unknown as IncomingMessage;

  return {
    url,
    raw,
    socketDestroyed: () => destroyed,
  };
}

function fastifyReply(): FastifyReplyLike & {
  statusCode: () => number;
  headers: () => Record<string, string>;
  body: () => unknown;
} {
  let statusCode = 200;
  let body: unknown;
  const headers: Record<string, string> = {};

  const reply = {
    code(code: number): FastifyReplyLike {
      statusCode = code;
      return reply;
    },
    header(name: string, value: string): FastifyReplyLike {
      headers[name] = value;
      return reply;
    },
    send(payload: unknown): unknown {
      body = payload;
      return reply;
    },
    statusCode: (): number => statusCode,
    headers: (): Record<string, string> => headers,
    body: (): unknown => body,
  };

  return reply;
}

function honoContext(path = '/api/test'): HonoContextLike {
  return { req: { path } };
}

describe('fastifyChaos', () => {
  it('validates options when the hook is created', () => {
    expect(() =>
      fastifyChaos({ ...passOptions, failureRate: 2 }),
    ).toThrow(ChaosConfigError);
  });

  it('passes through successful and excluded requests', async () => {
    const passHook = fastifyChaos(passOptions);
    const excludedHook = fastifyChaos({
      ...httpFailureOptions,
      excludeRoutes: ['/health'],
    });
    const reply = fastifyReply();

    await passHook(fastifyRequest(), reply);
    await excludedHook(fastifyRequest('/health'), reply);

    expect(reply.statusCode()).toBe(200);
    expect(reply.body()).toBeUndefined();
  });

  it('sends the resolved HTTP error response', async () => {
    const reply = fastifyReply();
    await fastifyChaos(httpFailureOptions)(fastifyRequest(), reply);

    expect(reply.statusCode()).toBe(503);
    expect(reply.headers()['X-Chaos-Injected']).toBe('1');
    expect(reply.body()).toEqual({
      error: 'Chaos injected error',
      status: 503,
    });
  });

  it('destroys the raw socket for TCP drop failures', async () => {
    const request = fastifyRequest();
    await fastifyChaos(tcpFailureOptions)(request, fastifyReply());
    expect(request.socketDestroyed()).toBe(true);
  });
});

describe('honoChaos', () => {
  it('validates options when middleware is created', () => {
    expect(() =>
      honoChaos({ ...passOptions, baseDelay: -1 }),
    ).toThrow(ChaosConfigError);
  });

  it('calls next for successful and excluded requests', async () => {
    const next = vi.fn(async (): Promise<void> => {});
    await honoChaos(passOptions)(honoContext(), next);
    await honoChaos({
      ...httpFailureOptions,
      excludeRoutes: ['/health'],
    })(honoContext('/health'), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('returns the resolved HTTP error response without calling next', async () => {
    const next = vi.fn(async (): Promise<void> => {});
    const response = await honoChaos(httpFailureOptions)(honoContext(), next);

    expect(response?.status).toBe(503);
    expect(response?.headers.get('X-Chaos-Injected')).toBe('1');
    await expect(response?.json()).resolves.toEqual({
      error: 'Chaos injected error',
      status: 503,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('approximates TCP drops with a marked 503 response', async () => {
    const response = await honoChaos(tcpFailureOptions)(
      honoContext(),
      async (): Promise<void> => {},
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get('X-Chaos-Tcp-Drop')).toBe('1');
  });
});
