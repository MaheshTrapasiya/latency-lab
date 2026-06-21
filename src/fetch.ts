/**
 * Outbound Fetch adapter for latency-lab.
 *
 * This module is browser-safe and has no Node.js imports.
 */

import { decideChaos, validateChaosOptions } from './core.js';
import { ChaosConfigError } from './types.js';
import type { ChaosOptions } from './types.js';

export type UrlMatcher = string | RegExp;

export interface FetchChaosOptions extends ChaosOptions {
  includeUrls?: readonly UrlMatcher[];
  excludeUrls?: readonly UrlMatcher[];
}

export interface FetchChaosInstallation {
  readonly fetch: typeof globalThis.fetch;
  restore(): void;
}

export class ChaosFetchError extends TypeError {
  override readonly name = 'ChaosFetchError';
  readonly code = 'ERR_CHAOS_TCP_DROP';
  readonly url: string;

  constructor(url: string) {
    super(`Chaos injected network failure for ${url}`);
    this.url = url;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function validateMatchers(
  name: 'includeUrls' | 'excludeUrls',
  matchers: readonly UrlMatcher[] | undefined,
): readonly UrlMatcher[] | undefined {
  if (matchers === undefined) return undefined;
  if (!Array.isArray(matchers)) {
    throw new ChaosConfigError(`FetchChaosOptions.${name} must be an array.`);
  }

  for (const matcher of matchers) {
    if (typeof matcher !== 'string' && !(matcher instanceof RegExp)) {
      throw new ChaosConfigError(
        `FetchChaosOptions.${name} entries must be strings or RegExp values.`,
      );
    }
  }
  return matchers as readonly UrlMatcher[];
}

function inputUrl(input: RequestInfo | URL): string | null {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  try {
    const base =
      typeof globalThis.location === 'object'
        ? globalThis.location.href
        : undefined;
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

function matchesUrl(url: string, matcher: UrlMatcher): boolean {
  if (typeof matcher === 'string') return url.startsWith(matcher);
  matcher.lastIndex = 0;
  return matcher.test(url);
}

function shouldApplyChaos(
  url: string,
  includeUrls: readonly UrlMatcher[] | undefined,
  excludeUrls: readonly UrlMatcher[] | undefined,
): boolean {
  if (excludeUrls?.some((matcher) => matchesUrl(url, matcher)) === true) {
    return false;
  }
  if (includeUrls === undefined) return true;
  return includeUrls.some((matcher) => matchesUrl(url, matcher));
}

function requestSignal(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): AbortSignal | undefined {
  if (init?.signal !== undefined && init.signal !== null) return init.signal;
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.signal;
  }
  return undefined;
}

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  if (typeof DOMException !== 'undefined') {
    return new DOMException('This operation was aborted', 'AbortError');
  }
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';
  return error;
}

function sleepWithSignal(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.reject(abortReason(signal));
  }
  if (milliseconds <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);

    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal === undefined ? new Error('Aborted') : abortReason(signal));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function errorResponse(statusCode: number): Response {
  return new Response(
    JSON.stringify({
      error: 'Chaos injected error',
      status: statusCode,
    }),
    {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-Chaos-Injected': '1',
      },
    },
  );
}

export function createChaosFetch(
  options: FetchChaosOptions,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  const validated = validateChaosOptions(options);
  const includeUrls = validateMatchers('includeUrls', options.includeUrls);
  const excludeUrls = validateMatchers('excludeUrls', options.excludeUrls);

  if (validated.errorCodes.some((code) => code < 400)) {
    throw new ChaosConfigError(
      'FetchChaosOptions.errorCodes must contain only HTTP error statuses in [400, 599].',
    );
  }

  if (typeof fetchImpl !== 'function') {
    throw new ChaosConfigError('A Fetch implementation is required.');
  }

  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = inputUrl(input);
    if (
      url === null ||
      !shouldApplyChaos(url, includeUrls, excludeUrls)
    ) {
      return fetchImpl.call(globalThis, input, init);
    }

    const signal = requestSignal(input, init);
    const decision = decideChaos(validated);
    await sleepWithSignal(decision.delay, signal);
    if (signal?.aborted === true) throw abortReason(signal);

    if (decision.outcome === 'http-error') {
      return errorResponse(decision.statusCode);
    }
    if (decision.outcome === 'tcp-drop') {
      throw new ChaosFetchError(url);
    }

    return fetchImpl.call(globalThis, input, init);
  };
}

export function installFetchChaos(
  options: FetchChaosOptions,
): FetchChaosInstallation {
  const originalFetch = globalThis.fetch;
  const chaosFetch = createChaosFetch(
    options,
    originalFetch.bind(globalThis),
  );
  let restored = false;

  globalThis.fetch = chaosFetch;

  return {
    fetch: chaosFetch,
    restore(): void {
      if (!restored && globalThis.fetch === chaosFetch) {
        globalThis.fetch = originalFetch;
        restored = true;
      }
    },
  };
}
