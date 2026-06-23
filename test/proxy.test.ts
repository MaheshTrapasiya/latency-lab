import http from 'node:http';
import net from 'node:net';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChaosProxy } from '../src/proxy.js';
import type { ChaosProxy, ChaosProxyConfig } from '../src/proxy.js';

const passChaos = {
  baseDelay: 0,
  jitter: 0,
  failureRate: 0,
  failureType: 'http-error' as const,
  errorCodes: [503],
};

const proxies: ChaosProxy[] = [];
const upstreams: Server[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map(async (proxy) => proxy.close()));
  await Promise.all(
    upstreams.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
          server.closeAllConnections?.();
        }),
    ),
  );
});

async function startUpstream(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<URL> {
  const server = http.createServer(handler);
  upstreams.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Missing upstream address');
  }
  return new URL('http://127.0.0.1:' + address.port);
}

async function startProxy(
  overrides: Partial<ChaosProxyConfig> = {},
): Promise<ChaosProxy> {
  const target =
    overrides.target ??
    (await startUpstream((_request, response) => {
      response.end('upstream');
    }));
  const proxy = await createChaosProxy({
    target,
    host: '127.0.0.1',
    port: 0,
    chaos: passChaos,
    quiet: true,
    ...overrides,
  });
  proxies.push(proxy);
  return proxy;
}

describe('createChaosProxy', () => {
  it('streams methods, bodies, queries, base paths, and forwarding headers', async () => {
    let receivedRequest: Record<string, unknown> | undefined;
    const target = await startUpstream((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        receivedRequest = {
          method: request.method,
          url: request.url,
          body,
          forwardedHost: request.headers['x-forwarded-host'],
          forwardedFor: request.headers['x-forwarded-for'],
          forwardedProto: request.headers['x-forwarded-proto'],
          host: request.headers.host,
        };
        response.writeHead(201, { 'X-Upstream': 'yes' });
        response.end('forwarded');
      });
    });
    target.pathname = '/base/';
    const logs: string[] = [];
    const proxy = await startProxy({
      target,
      quiet: false,
      logger: (message) => logs.push(message),
    });

    const response = await fetch(proxy.url + '/echo?value=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-Forwarded-For': '203.0.113.10',
      },
      body: 'payload',
    });
    await response.text();

    expect(response.status).toBe(201);
    expect(response.headers.get('X-Upstream')).toBe('yes');
    expect(receivedRequest).toMatchObject({
      method: 'POST',
      url: '/base/echo?value=1',
      body: 'payload',
      forwardedProto: 'http',
    });
    expect(String(receivedRequest?.['forwardedHost'])).toContain('127.0.0.1');
    expect(String(receivedRequest?.['forwardedFor'])).toContain(
      '203.0.113.10, 127.0.0.1',
    );
    expect(String(receivedRequest?.['host'])).toBe(target.host);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('POST /echo?value=1');
    expect(logs[0]).toContain('outcome=pass');
  });

  it('returns configured HTTP failures without contacting upstream', async () => {
    const upstreamHandler = vi.fn((_request, response: ServerResponse) => {
      response.end('unexpected');
    });
    const target = await startUpstream(upstreamHandler);
    const proxy = await startProxy({
      target,
      chaos: { ...passChaos, failureRate: 1 },
    });

    const response = await fetch(proxy.url + '/users');

    expect(response.status).toBe(503);
    expect(response.headers.get('X-Chaos-Injected')).toBe('1');
    expect(upstreamHandler).not.toHaveBeenCalled();
  });

  it('bypasses chaos for excluded routes', async () => {
    const proxy = await startProxy({
      chaos: {
        ...passChaos,
        failureRate: 1,
        excludeRoutes: ['/health'],
      },
    });

    const response = await fetch(proxy.url + '/health?ready=1');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('upstream');
  });

  it('uses includeRoutes as an allow-list', async () => {
    const proxy = await startProxy({
      chaos: {
        ...passChaos,
        failureRate: 1,
        includeRoutes: ['/api'],
      },
    });

    const healthResponse = await fetch(proxy.url + '/health');
    const apiResponse = await fetch(proxy.url + '/api/users');

    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.text()).toBe('upstream');
    expect(apiResponse.status).toBe(503);
  });

  it('applies per-route chaos overrides and bypasses', async () => {
    const proxy = await startProxy({
      chaos: {
        ...passChaos,
        routes: [
          {
            match: '/api/payments',
            chaos: { ...passChaos, failureRate: 1 },
          },
          { match: '/api/public', chaos: false },
        ],
      },
    });

    const paymentsResponse = await fetch(proxy.url + '/api/payments');
    const publicResponse = await fetch(proxy.url + '/api/public');

    expect(paymentsResponse.status).toBe(503);
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.text()).toBe('upstream');
  });

  it('destroys the client connection for TCP-drop outcomes', async () => {
    const proxy = await startProxy({
      chaos: {
        ...passChaos,
        failureRate: 1,
        failureType: 'tcp-drop',
      },
    });

    await expect(fetch(proxy.url + '/users')).rejects.toThrow();
  });

  it('returns a 502 when the upstream is unavailable', async () => {
    const unavailable = await startUpstream((_request, response) => {
      response.end();
    });
    const closed = upstreams.pop();
    if (closed === undefined) throw new Error('Missing upstream server');
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const logs: string[] = [];
    const proxy = await startProxy({
      target: unavailable,
      quiet: false,
      logger: (message) => logs.push(message),
    });

    const response = await fetch(proxy.url + '/users');

    expect(response.status).toBe(502);
    expect(response.headers.get('X-Chaos-Injected')).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: 'Upstream request failed',
    });
    expect(logs.some((line) => line.includes('outcome=upstream-error'))).toBe(true);
  });

  it('destroys the upstream request when the client aborts an upload', async () => {
    let resolveAborted: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      resolveAborted = resolve;
    });
    const target = await startUpstream((request) => {
      request.on('aborted', () => resolveAborted?.());
    });
    const proxy = await startProxy({ target });
    const address = proxy.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing proxy address');
    }

    const client = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: '/upload',
      method: 'POST',
      headers: { 'Content-Length': '1000' },
    });
    client.on('error', () => undefined);
    client.write('partial');
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    client.destroy();

    await expect(
      Promise.race([
        aborted,
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error('abort not forwarded')), 1000);
        }),
      ]),
    ).resolves.toBeUndefined();
  });

  it('suppresses request logs in quiet mode', async () => {
    const logger = vi.fn();
    const proxy = await startProxy({ quiet: true, logger });
    await fetch(proxy.url);
    expect(logger).not.toHaveBeenCalled();
  });

  it('uses the default logger when request logging is enabled', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const proxy = await startProxy({ quiet: false });

    await fetch(proxy.url + '/logged');

    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('outcome=pass'),
    );
  });

  it('returns a defensive 500 if request processing throws', async () => {
    const proxy = await startProxy({
      quiet: false,
      logger: () => {
        throw new Error('logger failed');
      },
    });

    const response = await fetch(proxy.url);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Chaos proxy failed',
      message: 'logger failed',
    });
  });

  it('rejects WebSocket upgrade requests with 426', async () => {
    const proxy = await startProxy();
    const address = proxy.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing proxy address');
    }

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(address.port, '127.0.0.1');
      let data = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => {
        socket.write(
          'GET / HTTP/1.1\r\n' +
            'Host: localhost\r\n' +
            'Connection: Upgrade\r\n' +
            'Upgrade: websocket\r\n\r\n',
        );
      });
      socket.on('data', (chunk: string) => {
        data += chunk;
      });
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });

    expect(response).toContain('426 Upgrade Required');
  });

  it('rejects unsupported targets and occupied ports', async () => {
    await expect(
      createChaosProxy({
        target: new URL('ftp://example.com'),
        host: '127.0.0.1',
        port: 0,
        chaos: passChaos,
      }),
    ).rejects.toThrow('http: or https:');

    const first = await startProxy();
    const address = first.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing proxy address');
    }
    await expect(
      createChaosProxy({
        target: new URL('http://127.0.0.1'),
        host: '127.0.0.1',
        port: address.port,
        chaos: passChaos,
      }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('closes idempotently', async () => {
    const proxy = await startProxy();
    await proxy.close();
    await proxy.close();
    expect(proxy.server.listening).toBe(false);
  });
});
