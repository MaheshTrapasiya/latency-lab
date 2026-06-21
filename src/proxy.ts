import http from 'node:http';
import https from 'node:https';
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { decideChaos, isExcluded, sleep, validateChaosOptions } from './core.js';
import type { MiddlewareOptions } from './types.js';

export type ProxyOutcome =
  | 'excluded'
  | 'pass'
  | 'http-error'
  | 'tcp-drop'
  | 'upstream-error';

export interface ChaosProxyConfig {
  target: URL;
  host: string;
  port: number;
  chaos: MiddlewareOptions;
  quiet?: boolean;
  logger?: (message: string) => void;
}

export interface ChaosProxy {
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
}

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function defaultLogger(message: string): void {
  process.stdout.write(message + '\n');
}

function filteredHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !hopByHopHeaders.has(name.toLowerCase()),
    ),
  );
}

function incomingPath(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', 'http://latency-lab.local');
}

function upstreamPath(target: URL, incoming: URL): string {
  const basePath = target.pathname === '/' ? '' : target.pathname.replace(/\/$/, '');
  return basePath + incoming.pathname + incoming.search || '/';
}

function appendForwardedFor(
  current: string | string[] | undefined,
  remoteAddress: string | undefined,
): string | undefined {
  const existing = Array.isArray(current) ? current.join(', ') : current;
  if (remoteAddress === undefined) return existing;
  return existing === undefined
    ? remoteAddress
    : existing + ', ' + remoteAddress;
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): void {
  /* c8 ignore next 4 -- defensive path after a response has already started */
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function logRequest(
  config: ChaosProxyConfig,
  request: IncomingMessage,
  delay: number,
  outcome: ProxyOutcome,
): void {
  if (config.quiet === true) return;
  const logger = config.logger ?? defaultLogger;
  logger(
    '[latency-lab] ' + (request.method ?? 'GET') + ' ' +
      (request.url ?? '/') + ' delay=' + Math.round(delay) +
      'ms outcome=' + outcome,
  );
}

function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: ChaosProxyConfig,
): void {
  const incoming = incomingPath(request);
  const headers = filteredHeaders(request.headers);
  headers.host = config.target.host;
  headers['x-forwarded-host'] = request.headers.host;
  headers['x-forwarded-proto'] =
    'encrypted' in request.socket ? 'https' : 'http';
  headers['x-forwarded-for'] = appendForwardedFor(
    request.headers['x-forwarded-for'],
    request.socket.remoteAddress,
  );

  const requestFn =
    config.target.protocol === 'https:' ? https.request : http.request;
  const upstream = requestFn(
    {
      protocol: config.target.protocol,
      hostname: config.target.hostname,
      port: config.target.port,
      method: request.method,
      path: upstreamPath(config.target, incoming),
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        filteredHeaders(upstreamResponse.headers),
      );
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('error', (error) => {
    logRequest(config, request, 0, 'upstream-error');
    writeJson(response, 502, {
      error: 'Upstream request failed',
      message: error.message,
    });
  });
  request.on('aborted', () => {
    upstream.destroy();
  });
  request.pipe(upstream);
}

function createRequestHandler(
  config: ChaosProxyConfig,
): (request: IncomingMessage, response: ServerResponse) => void {
  const validated = validateChaosOptions(config.chaos);
  const excludeRoutes = config.chaos.excludeRoutes ?? [];

  return (request, response): void => {
    (async (): Promise<void> => {
      const pathname = incomingPath(request).pathname;
      if (isExcluded(pathname, excludeRoutes)) {
        logRequest(config, request, 0, 'excluded');
        proxyRequest(request, response, config);
        return;
      }

      const decision = decideChaos(validated);
      await sleep(decision.delay);

      if (decision.outcome === 'http-error') {
        logRequest(config, request, decision.delay, 'http-error');
        writeJson(response, decision.statusCode, {
          error: 'Chaos injected error',
          status: decision.statusCode,
        }, {
          'X-Chaos-Injected': '1',
        });
        return;
      }
      if (decision.outcome === 'tcp-drop') {
        logRequest(config, request, decision.delay, 'tcp-drop');
        request.socket.destroy();
        return;
      }

      logRequest(config, request, decision.delay, 'pass');
      proxyRequest(request, response, config);
    })().catch((error: unknown) => {
      writeJson(response, 500, {
        error: 'Chaos proxy failed',
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };
}

export async function createChaosProxy(
  config: ChaosProxyConfig,
): Promise<ChaosProxy> {
  if (!['http:', 'https:'].includes(config.target.protocol)) {
    throw new Error('Proxy target must use http: or https:.');
  }

  const server = http.createServer(createRequestHandler(config));
  server.on('upgrade', (_request, socket) => {
    socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n');
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.port, config.host);
  });

  const address = server.address();
  /* c8 ignore next 4 -- successful TCP listen always has an object address */
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Unable to determine proxy address.');
  }
  /* c8 ignore next 3 -- IPv6 formatting is platform-dependent */
  const displayHost = address.address.includes(':')
    ? '[' + address.address + ']'
    : address.address;

  return {
    server,
    url: 'http://' + displayHost + ':' + address.port,
    close(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => {
          if (error !== undefined) reject(error);
          else resolve();
        });
        server.closeAllConnections?.();
      });
    },
  };
}
