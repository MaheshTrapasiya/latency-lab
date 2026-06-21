import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChaosFetch,
  installFetchChaos,
} from '../src/fetch.js';
import { ChaosConfigError } from '../src/types.js';
import type { ChaosFetchError, FetchChaosOptions } from '../src/fetch.js';

const passOptions: FetchChaosOptions = {
  baseDelay: 0,
  jitter: 0,
  failureRate: 0,
  failureType: 'http-error',
  errorCodes: [503],
};

const httpFailureOptions: FetchChaosOptions = {
  ...passOptions,
  failureRate: 1,
};

const tcpFailureOptions: FetchChaosOptions = {
  ...httpFailureOptions,
  failureType: 'tcp-drop',
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

function mockFetch(response = new Response('ok')): typeof fetch {
  return vi.fn(async (): Promise<Response> => response) as unknown as typeof fetch;
}

describe('createChaosFetch', () => {
  it('validates chaos options, matchers, and the Fetch implementation', () => {
    expect(() =>
      createChaosFetch({ ...passOptions, failureRate: 2 }, mockFetch()),
    ).toThrow(ChaosConfigError);
    expect(() =>
      createChaosFetch(
        { ...passOptions, includeUrls: [42 as unknown as string] },
        mockFetch(),
      ),
    ).toThrow(ChaosConfigError);
    expect(() =>
      createChaosFetch(
        { ...passOptions, excludeUrls: 'nope' as unknown as string[] },
        mockFetch(),
      ),
    ).toThrow(ChaosConfigError);
    expect(() =>
      createChaosFetch(
        passOptions,
        undefined as unknown as typeof fetch,
      ),
    ).not.toThrow();
    expect(() =>
      createChaosFetch({ ...passOptions, errorCodes: [204] }, mockFetch()),
    ).toThrow('HTTP error statuses');
  });

  it('passes through string, URL, and Request inputs unchanged', async () => {
    const original = mockFetch();
    const chaosFetch = createChaosFetch(passOptions, original);
    const url = new URL('https://api.example.com/url');
    const request = new Request('https://api.example.com/request');

    await chaosFetch('https://api.example.com/string', { method: 'POST' });
    await chaosFetch(url);
    await chaosFetch(request);

    expect(original).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/string',
      { method: 'POST' },
    );
    expect(original).toHaveBeenNthCalledWith(2, url, undefined);
    expect(original).toHaveBeenNthCalledWith(3, request, undefined);
  });

  it('delegates invalid URLs so native Fetch behavior is preserved', async () => {
    const original = mockFetch();
    await createChaosFetch(httpFailureOptions, original)('/relative');
    expect(original).toHaveBeenCalledWith('/relative', undefined);
  });

  it('resolves relative URLs against a browser location when available', async () => {
    const original = mockFetch();
    const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'https://app.example.com/base' },
    });
    try {
      const response = await createChaosFetch(
        { ...httpFailureOptions, includeUrls: ['https://app.example.com/'] },
        original,
      )('/users');
      expect(response.status).toBe(503);
      expect(original).not.toHaveBeenCalled();
    } finally {
      if (previousLocation === undefined) {
        Reflect.deleteProperty(globalThis, 'location');
      } else {
        Object.defineProperty(globalThis, 'location', previousLocation);
      }
    }
  });

  it('supports include and exclude URL prefixes with exclusion precedence', async () => {
    const original = mockFetch();
    const chaosFetch = createChaosFetch(
      {
        ...httpFailureOptions,
        includeUrls: ['https://api.example.com/'],
        excludeUrls: ['https://api.example.com/health'],
      },
      original,
    );

    const included = await chaosFetch('https://api.example.com/users');
    const excluded = await chaosFetch('https://api.example.com/health');
    const outside = await chaosFetch('https://other.example.com/users');

    expect(included.status).toBe(503);
    expect(excluded.status).toBe(200);
    expect(outside.status).toBe(200);
    expect(original).toHaveBeenCalledTimes(2);
  });

  it('supports RegExp matchers without leaking lastIndex state', async () => {
    const original = mockFetch();
    const matcher = /api\.example\.com\/users/g;
    const chaosFetch = createChaosFetch(
      { ...httpFailureOptions, includeUrls: [matcher] },
      original,
    );

    expect((await chaosFetch('https://api.example.com/users/1')).status).toBe(503);
    expect((await chaosFetch('https://api.example.com/users/2')).status).toBe(503);
    expect(original).not.toHaveBeenCalled();
  });

  it('returns a synthetic marked JSON response for HTTP failures', async () => {
    const original = mockFetch();
    const response = await createChaosFetch(
      httpFailureOptions,
      original,
    )('https://api.example.com/users');

    expect(response.status).toBe(503);
    expect(response.headers.get('X-Chaos-Injected')).toBe('1');
    await expect(response.json()).resolves.toEqual({
      error: 'Chaos injected error',
      status: 503,
    });
    expect(original).not.toHaveBeenCalled();
  });

  it('rejects TCP drops with a typed network error', async () => {
    const original = mockFetch();
    await expect(
      createChaosFetch(tcpFailureOptions, original)(
        'https://api.example.com/users',
      ),
    ).rejects.toMatchObject({
      name: 'ChaosFetchError',
      code: 'ERR_CHAOS_TCP_DROP',
      url: 'https://api.example.com/users',
    } satisfies Partial<ChaosFetchError>);
    expect(original).not.toHaveBeenCalled();
  });

  it('waits for the resolved delay before calling Fetch', async () => {
    vi.useFakeTimers();
    const original = mockFetch();
    const pending = createChaosFetch(
      { ...passOptions, baseDelay: 250 },
      original,
    )('https://api.example.com/users');

    await vi.advanceTimersByTimeAsync(249);
    expect(original).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(original).toHaveBeenCalledOnce();
  });

  it('respects signals aborted before or during the injected delay', async () => {
    vi.useFakeTimers();
    const original = mockFetch();
    const chaosFetch = createChaosFetch(
      { ...passOptions, baseDelay: 250 },
      original,
    );
    const alreadyAborted = new AbortController();
    alreadyAborted.abort(new Error('already aborted'));

    await expect(
      chaosFetch('https://api.example.com/first', {
        signal: alreadyAborted.signal,
      }),
    ).rejects.toThrow('already aborted');

    const duringDelay = new AbortController();
    const pending = chaosFetch(
      new Request('https://api.example.com/second', {
        signal: duringDelay.signal,
      }),
    );
    duringDelay.abort(new Error('aborted during delay'));
    await expect(pending).rejects.toThrow('aborted during delay');
    expect(original).not.toHaveBeenCalled();
  });

  it('creates AbortError fallbacks when a signal has no reason', async () => {
    const original = mockFetch();
    const signal = {
      aborted: true,
      reason: undefined,
    } as unknown as AbortSignal;
    await expect(
      createChaosFetch(passOptions, original)(
        'https://api.example.com/first',
        { signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    const originalDomException = globalThis.DOMException;
    Object.defineProperty(globalThis, 'DOMException', {
      configurable: true,
      value: undefined,
    });
    try {
      await expect(
        createChaosFetch(passOptions, original)(
          'https://api.example.com/second',
          { signal },
        ),
      ).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      Object.defineProperty(globalThis, 'DOMException', {
        configurable: true,
        value: originalDomException,
      });
    }
  });

  it('requires a Fetch implementation when no global Fetch exists', () => {
    const previousFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: undefined,
    });
    try {
      expect(() => createChaosFetch(passOptions)).toThrow(
        'Fetch implementation is required',
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('preserves errors thrown by the original Fetch implementation', async () => {
    const expected = new TypeError('native fetch failed');
    const original = vi.fn(async (): Promise<Response> => {
      throw expected;
    }) as unknown as typeof fetch;

    await expect(
      createChaosFetch(passOptions, original)('https://api.example.com/users'),
    ).rejects.toBe(expected);
  });
});

describe('installFetchChaos', () => {
  it('installs globally and restores idempotently', async () => {
    globalThis.fetch = mockFetch();
    const original = globalThis.fetch;
    const installation = installFetchChaos(httpFailureOptions);

    expect(globalThis.fetch).toBe(installation.fetch);
    expect((await globalThis.fetch('https://api.example.com')).status).toBe(503);

    installation.restore();
    installation.restore();
    expect(globalThis.fetch).toBe(original);
  });

  it('does not overwrite newer installations during out-of-order restore', () => {
    globalThis.fetch = mockFetch();
    const original = globalThis.fetch;
    const first = installFetchChaos(passOptions);
    const second = installFetchChaos(httpFailureOptions);

    first.restore();
    expect(globalThis.fetch).toBe(second.fetch);

    second.restore();
    expect(globalThis.fetch).toBe(first.fetch);

    first.restore();
    expect(globalThis.fetch).toBe(original);
  });
});
