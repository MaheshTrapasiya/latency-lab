import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { chaosMiddleware } from '../src/express.js';
import { withChaos } from '../src/next.js';
import { presets } from '../src/presets.js';
import { ChaosConfigError } from '../src/types.js';
import type { MiddlewareOptions } from '../src/types.js';
import type { NextRequestLike, NextResponseLike } from '../src/next.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal mock IncomingMessage. */
function mockReq(url = '/api/test'): IncomingMessage {
  return { url } as unknown as IncomingMessage;
}

/** Creates a minimal mock ServerResponse with controllable state. */
function mockRes(): ServerResponse & {
  _statusCode: number;
  _body: string;
  _destroyed: boolean;
  socket: { destroy: () => void; destroyed: boolean };
} {
  let statusCode = 200;
  let body = '';
  let headersSent = false;
  let destroyed = false;

  const socket = {
    destroy: (): void => { destroyed = true; },
    get destroyed(): boolean { return destroyed; },
  };

  const res = {
    get statusCode(): number { return statusCode; },
    set statusCode(v: number) { statusCode = v; },
    get headersSent(): boolean { return headersSent; },
    get _statusCode(): number { return statusCode; },
    get _body(): string { return body; },
    get _destroyed(): boolean { return destroyed; },
    socket,
    writeHead(code: number): void {
      statusCode = code;
      headersSent = true;
    },
    end(data?: string): void {
      body = data ?? '';
    },
  };

  return res as unknown as ReturnType<typeof mockRes>;
}

/** Creates a minimal mock NextRequest-like object. */
function mockNextReq(url = 'https://example.com/api/test'): NextRequestLike {
  return {
    url,
    method: 'GET',
    headers: new Headers(),
  };
}

/** Creates a minimal mock NextResponse-like object. */
function mockNextRes(status = 200): NextResponseLike {
  const headers = new Headers({ 'content-type': 'application/json' });
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    url: '',
    redirected: false,
    type: 'default',
    bodyUsed: false,
    body: null,
    clone: () => mockNextRes(status),
    json: async () => ({}),
    text: async () => '',
    blob: async () => new Blob(),
    arrayBuffer: async () => new ArrayBuffer(0),
    formData: async () => new FormData(),
  } as unknown as NextResponseLike;
}

const zeroFailureOptions: MiddlewareOptions = {
  baseDelay: 0,
  jitter: 0,
  failureRate: 0,
  failureType: 'http-error',
  errorCodes: [503],
};

const alwaysFailHttpOptions: MiddlewareOptions = {
  baseDelay: 0,
  jitter: 0,
  failureRate: 1,
  failureType: 'http-error',
  errorCodes: [503],
};

const alwaysFailTcpOptions: MiddlewareOptions = {
  ...alwaysFailHttpOptions,
  failureType: 'tcp-drop',
};

// ---------------------------------------------------------------------------
// Express adapter
// ---------------------------------------------------------------------------

describe('chaosMiddleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws ChaosConfigError immediately on invalid options', () => {
    expect(() =>
      chaosMiddleware({ ...zeroFailureOptions, failureRate: 5 }),
    ).toThrow(ChaosConfigError);
  });

  it('calls next() when no failure occurs (passthrough)', async () => {
    const middleware = chaosMiddleware(zeroFailureOptions);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    const p = new Promise<void>((resolve) => {
      middleware(req, res, (...args) => {
        next(...args);
        resolve();
      });
    });

    vi.runAllTimersAsync().catch(() => undefined);
    await p;

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(); // called with no arguments = success
  });

  it('sends an HTTP error response and does NOT call next() on http-error failure', async () => {
    const middleware = chaosMiddleware(alwaysFailHttpOptions);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    const p = new Promise<void>((resolve) => {
      // We resolve after a tick since middleware is async
      setImmediate(resolve);
      middleware(req, res, next);
    });

    vi.runAllTimersAsync().catch(() => undefined);
    await p;
    // Allow microtasks to flush
    await Promise.resolve();
    await Promise.resolve();

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(503);
  });

  it('destroys the socket and does NOT call next() on tcp-drop failure', async () => {
    const middleware = chaosMiddleware(alwaysFailTcpOptions);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    const p = new Promise<void>((resolve) => {
      setImmediate(resolve);
      middleware(req, res, next);
    });

    vi.runAllTimersAsync().catch(() => undefined);
    await p;
    await Promise.resolve();
    await Promise.resolve();

    expect(next).not.toHaveBeenCalled();
    expect(res._destroyed).toBe(true);
  });

  it('skips chaos for excluded routes and calls next()', async () => {
    const middleware = chaosMiddleware({
      ...alwaysFailHttpOptions,
      excludeRoutes: ['/health'],
    });
    const req = mockReq('/health');
    const res = mockRes();
    const next = vi.fn();

    const p = new Promise<void>((resolve) => {
      middleware(req, res, (...args) => {
        next(...args);
        resolve();
      });
    });

    vi.runAllTimersAsync().catch(() => undefined);
    await p;

    expect(next).toHaveBeenCalledOnce();
    expect(res._statusCode).toBe(200); // no error written
  });

  it('applies chaos for non-excluded routes even when excludeRoutes is set', async () => {
    const middleware = chaosMiddleware({
      ...alwaysFailHttpOptions,
      excludeRoutes: ['/health'],
    });
    const req = mockReq('/api/users');
    const res = mockRes();
    const next = vi.fn();

    const p = new Promise<void>((resolve) => {
      setImmediate(resolve);
      middleware(req, res, next);
    });

    vi.runAllTimersAsync().catch(() => undefined);
    await p;
    await Promise.resolve();
    await Promise.resolve();

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(503);
  });

  it('respects baseDelay by sleeping before forwarding', async () => {
    const opts: MiddlewareOptions = {
      ...zeroFailureOptions,
      baseDelay: 500,
      jitter: 0,
    };
    const middleware = chaosMiddleware(opts);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    let resolved = false;
    const p = new Promise<void>((resolve) => {
      middleware(req, res, () => {
        next();
        resolved = true;
        resolve();
      });
    });

    // Advance by less than the delay — next() should not have fired yet
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).toBe(false);

    // Now advance past the delay
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(resolved).toBe(true);
    expect(next).toHaveBeenCalledOnce();
  });

  it('works with the flakyCafeWifi preset (smoke test)', async () => {
    const middleware = chaosMiddleware({
      ...presets.flakyCafeWifi,
      failureRate: 0, // disable failures for deterministic test
    });
    const req = mockReq('/api/posts');
    const res = mockRes();
    const next = vi.fn();

    const p = new Promise<void>((resolve) => {
      middleware(req, res, () => {
        next();
        resolve();
      });
    });

    await vi.runAllTimersAsync();
    await p;

    expect(next).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Next.js adapter
// ---------------------------------------------------------------------------

describe('withChaos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws ChaosConfigError immediately on invalid options', () => {
    const handler = async (_req: NextRequestLike): Promise<NextResponseLike> =>
      mockNextRes();

    expect(() =>
      withChaos(handler, { ...zeroFailureOptions, jitter: -1 }),
    ).toThrow(ChaosConfigError);
  });

  it('delegates to the original handler when no failure occurs', async () => {
    const handler = vi.fn().mockResolvedValue(mockNextRes(200)) as (
      req: NextRequestLike,
    ) => Promise<NextResponseLike>;

    const wrapped = withChaos(handler, zeroFailureOptions);
    const req = mockNextReq();

    const p = wrapped(req);
    await vi.runAllTimersAsync();
    const res = await p;

    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it('returns an HTTP error response (not calling original) on http-error failure', async () => {
    const handler = vi.fn().mockResolvedValue(mockNextRes(200)) as (
      req: NextRequestLike,
    ) => Promise<NextResponseLike>;

    const wrapped = withChaos(handler, alwaysFailHttpOptions);
    const req = mockNextReq();

    const p = wrapped(req);
    await vi.runAllTimersAsync();
    const res = await p;

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
  });

  it('returns a 503 response with tcp-drop header on tcp-drop failure', async () => {
    const handler = vi.fn().mockResolvedValue(mockNextRes(200)) as (
      req: NextRequestLike,
    ) => Promise<NextResponseLike>;

    const wrapped = withChaos(handler, alwaysFailTcpOptions);
    const req = mockNextReq();

    const p = wrapped(req);
    await vi.runAllTimersAsync();
    const res = await p;

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(res.headers.get('X-Chaos-Tcp-Drop')).toBe('1');
  });

  it('skips chaos for excluded routes and delegates to handler', async () => {
    const handler = vi.fn().mockResolvedValue(mockNextRes(200)) as (
      req: NextRequestLike,
    ) => Promise<NextResponseLike>;

    const wrapped = withChaos(handler, {
      ...alwaysFailHttpOptions,
      excludeRoutes: ['/api/health'],
    });
    const req = mockNextReq('https://example.com/api/health');

    const p = wrapped(req);
    await vi.runAllTimersAsync();
    const res = await p;

    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it('applies chaos to non-excluded routes', async () => {
    const handler = vi.fn().mockResolvedValue(mockNextRes(200)) as (
      req: NextRequestLike,
    ) => Promise<NextResponseLike>;

    const wrapped = withChaos(handler, {
      ...alwaysFailHttpOptions,
      excludeRoutes: ['/api/health'],
    });
    const req = mockNextReq('https://example.com/api/users');

    const p = wrapped(req);
    await vi.runAllTimersAsync();
    const res = await p;

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
  });

  it('propagates the context argument to the original handler', async () => {
    const handler = vi.fn().mockResolvedValue(mockNextRes(200)) as (
      req: NextRequestLike,
      ctx?: unknown,
    ) => Promise<NextResponseLike>;

    const wrapped = withChaos(handler, zeroFailureOptions);
    const req = mockNextReq();
    const ctx = { params: { id: '42' } };

    const p = wrapped(req, ctx);
    await vi.runAllTimersAsync();
    await p;

    expect(handler).toHaveBeenCalledWith(req, ctx);
  });

  it('respects baseDelay before delegating', async () => {
    let called = false;
    const handler = vi.fn(async (_req: NextRequestLike) => {
      called = true;
      return mockNextRes(200);
    });

    const opts: MiddlewareOptions = { ...zeroFailureOptions, baseDelay: 300, jitter: 0 };
    const wrapped = withChaos(handler, opts);
    const req = mockNextReq();

    const p = wrapped(req);

    await vi.advanceTimersByTimeAsync(299);
    expect(called).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(called).toBe(true);
  });

  it('works with the slow3g preset (smoke test)', async () => {
    const handler = vi.fn().mockResolvedValue(mockNextRes(200)) as (
      req: NextRequestLike,
    ) => Promise<NextResponseLike>;

    const wrapped = withChaos(handler, {
      ...presets.slow3g,
      failureRate: 0,
    });
    const req = mockNextReq();

    const p = wrapped(req);
    await vi.runAllTimersAsync();
    const res = await p;

    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Preset correctness
// ---------------------------------------------------------------------------

describe('presets', () => {
  it('all presets pass validation', async () => {
    const { validateChaosOptions } = await import('../src/core.js');
    for (const [name, preset] of Object.entries(presets)) {
      expect(
        () => validateChaosOptions(preset),
        `Preset "${name}" should be valid`,
      ).not.toThrow();
    }
  });

  it('subwayTunnel has high failure rate', () => {
    expect(presets.subwayTunnel.failureRate).toBeGreaterThanOrEqual(0.15);
  });

  it('slow3g has lower failure rate than congestedStadium', () => {
    expect(presets.slow3g.failureRate).toBeLessThan(presets.congestedStadium.failureRate);
  });

  it('includes the v1.1 network profiles', () => {
    expect(presets.satelliteLink.baseDelay).toBeGreaterThanOrEqual(600);
    expect(presets.mobileDataRoaming.jitter).toBeGreaterThan(
      presets.corpVPN.jitter,
    );
    expect(presets.corpVPN.failureType).toBe('tcp-drop');
  });

  it('presets are frozen (immutable)', () => {
    expect(Object.isFrozen(presets.slow3g)).toBe(true);
    expect(Object.isFrozen(presets.flakyCafeWifi)).toBe(true);
  });

  it('all presets have non-empty errorCodes', () => {
    for (const preset of Object.values(presets)) {
      expect(preset.errorCodes.length).toBeGreaterThan(0);
    }
  });

  it('all presets have wavePeriod set', () => {
    for (const [name, preset] of Object.entries(presets)) {
      expect(preset.wavePeriod, `Preset "${name}" should have wavePeriod`).toBeDefined();
      expect(preset.wavePeriod).toBeGreaterThan(0);
    }
  });
});
