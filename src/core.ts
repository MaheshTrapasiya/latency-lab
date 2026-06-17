import { ChaosConfigError } from './types.js';
import type { ChaosOptions, ResolvedFailureType } from './types.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a raw object as a `ChaosOptions`. Throws `ChaosConfigError`
 * with a descriptive message if any field is invalid or missing.
 *
 * This is the single source of truth for option validation — all public
 * entry-points (middleware factories, `withChaos`, etc.) should call this
 * before storing or using options.
 */
export function validateChaosOptions(options: unknown): ChaosOptions {
  if (options === null || typeof options !== 'object') {
    throw new ChaosConfigError('ChaosOptions must be a plain object.');
  }

  const o = options as Record<string, unknown>;

  // --- baseDelay -----------------------------------------------------------
  if (typeof o['baseDelay'] !== 'number' || !Number.isFinite(o['baseDelay'])) {
    throw new ChaosConfigError(
      `ChaosOptions.baseDelay must be a finite number, got: ${String(o['baseDelay'])}`,
    );
  }
  if (o['baseDelay'] < 0) {
    throw new ChaosConfigError(
      `ChaosOptions.baseDelay must be ≥ 0, got: ${String(o['baseDelay'])}`,
    );
  }

  // --- jitter --------------------------------------------------------------
  if (typeof o['jitter'] !== 'number' || !Number.isFinite(o['jitter'])) {
    throw new ChaosConfigError(
      `ChaosOptions.jitter must be a finite number, got: ${String(o['jitter'])}`,
    );
  }
  if (o['jitter'] < 0) {
    throw new ChaosConfigError(
      `ChaosOptions.jitter must be ≥ 0, got: ${String(o['jitter'])}`,
    );
  }

  // --- wavePeriod (optional) -----------------------------------------------
  if (o['wavePeriod'] !== undefined) {
    if (typeof o['wavePeriod'] !== 'number' || !Number.isFinite(o['wavePeriod'])) {
      throw new ChaosConfigError(
        `ChaosOptions.wavePeriod must be a finite number when provided, got: ${String(o['wavePeriod'])}`,
      );
    }
    if (o['wavePeriod'] <= 0) {
      throw new ChaosConfigError(
        `ChaosOptions.wavePeriod must be > 0 when provided, got: ${String(o['wavePeriod'])}`,
      );
    }
  }

  // --- failureRate ---------------------------------------------------------
  if (typeof o['failureRate'] !== 'number' || !Number.isFinite(o['failureRate'])) {
    throw new ChaosConfigError(
      `ChaosOptions.failureRate must be a finite number, got: ${String(o['failureRate'])}`,
    );
  }
  if (o['failureRate'] < 0 || o['failureRate'] > 1) {
    throw new ChaosConfigError(
      `ChaosOptions.failureRate must be in [0, 1], got: ${String(o['failureRate'])}`,
    );
  }

  // --- failureType ---------------------------------------------------------
  const validFailureTypes = new Set<string>(['http-error', 'tcp-drop', 'random']);
  if (typeof o['failureType'] !== 'string' || !validFailureTypes.has(o['failureType'])) {
    throw new ChaosConfigError(
      `ChaosOptions.failureType must be one of "http-error" | "tcp-drop" | "random", ` +
        `got: ${String(o['failureType'])}`,
    );
  }

  // --- errorCodes ----------------------------------------------------------
  if (!Array.isArray(o['errorCodes'])) {
    throw new ChaosConfigError(
      `ChaosOptions.errorCodes must be an array, got: ${typeof o['errorCodes']}`,
    );
  }
  if (o['errorCodes'].length === 0) {
    throw new ChaosConfigError(
      'ChaosOptions.errorCodes must contain at least one HTTP status code.',
    );
  }
  for (const code of o['errorCodes'] as unknown[]) {
    if (typeof code !== 'number' || !Number.isInteger(code) || code < 100 || code > 599) {
      throw new ChaosConfigError(
        `ChaosOptions.errorCodes contains invalid HTTP status code: ${String(code)}. ` +
          'Each code must be an integer in [100, 599].',
      );
    }
  }

  return {
    baseDelay: o['baseDelay'] as number,
    jitter: o['jitter'] as number,
    ...(o['wavePeriod'] !== undefined ? { wavePeriod: o['wavePeriod'] as number } : {}),
    failureRate: o['failureRate'] as number,
    failureType: o['failureType'] as ChaosOptions['failureType'],
    errorCodes: o['errorCodes'] as number[],
  };
}

// ---------------------------------------------------------------------------
// Delay calculation
// ---------------------------------------------------------------------------

/**
 * Compute a realistic delay for a single request, in milliseconds.
 *
 * Formula:
 * ```
 * delay = baseDelay + randomJitter + waveFluctuation
 * ```
 *
 * - **randomJitter**: sampled uniformly from `[-jitter, +jitter]`
 * - **waveFluctuation**: `sin(t * 2π / wavePeriod) * jitter * 0.5` where
 *   `t = Date.now() / 1000` in seconds (zero when `wavePeriod` is omitted)
 * - Result is clamped to `≥ 0` (negative delays are meaningless)
 *
 * @param options - Validated `ChaosOptions`.
 * @returns Delay in milliseconds (always ≥ 0).
 */
export function calculateDelay(options: ChaosOptions): number {
  const { baseDelay, jitter, wavePeriod } = options;

  // Uniform random jitter: value in [-jitter, +jitter]
  const randomJitter = (Math.random() * 2 - 1) * jitter;

  // Sine-wave fluctuation — models slow oscillation in network quality
  let waveFluctuation = 0;
  if (wavePeriod !== undefined) {
    const tSeconds = Date.now() / 1000;
    const phase = (tSeconds * (2 * Math.PI)) / wavePeriod;
    // Scale by half the jitter magnitude so the wave amplitude stays within
    // the same order of magnitude as the random jitter component.
    waveFluctuation = Math.sin(phase) * jitter * 0.5;
  }

  const raw = baseDelay + randomJitter + waveFluctuation;
  return Math.max(0, raw);
}

// ---------------------------------------------------------------------------
// Failure logic
// ---------------------------------------------------------------------------

/**
 * Returns `true` with probability `options.failureRate`.
 *
 * Uses `Math.random()` — suitable for non-cryptographic simulation purposes.
 *
 * @param options - Validated `ChaosOptions`.
 */
export function shouldFail(options: ChaosOptions): boolean {
  if (options.failureRate === 0) return false;
  if (options.failureRate === 1) return true;
  return Math.random() < options.failureRate;
}

/**
 * Picks a random HTTP status code from `options.errorCodes`.
 *
 * Assumes `options.errorCodes` is non-empty (enforced by `validateChaosOptions`).
 *
 * @param options - Validated `ChaosOptions`.
 * @returns A status code from the configured pool.
 */
export function pickErrorCode(options: ChaosOptions): number {
  const { errorCodes } = options;
  if (errorCodes.length === 0) {
    // Guard: this should never happen after validation, but we protect anyway.
    throw new ChaosConfigError(
      'Cannot pick an error code from an empty errorCodes array.',
    );
  }
  const index = Math.floor(Math.random() * errorCodes.length);
  // Non-null assertion is safe: index is always in [0, errorCodes.length - 1]
  return errorCodes[index]!;
}

/**
 * Resolves the configured `failureType` to a concrete action.
 *
 * When `failureType` is `'random'`, randomly selects between `'http-error'`
 * and `'tcp-drop'` with equal probability.
 *
 * @param options - Validated `ChaosOptions`.
 * @returns A `ResolvedFailureType` — never `'random'`.
 */
export function resolveFailureType(options: ChaosOptions): ResolvedFailureType {
  if (options.failureType === 'random') {
    return Math.random() < 0.5 ? 'http-error' : 'tcp-drop';
  }
  return options.failureType;
}

// ---------------------------------------------------------------------------
// Async utilities
// ---------------------------------------------------------------------------

/**
 * Non-blocking async sleep.
 *
 * Uses `setTimeout` under the hood — never busy-waits, never blocks the
 * event loop. Safe to `await` from any async context.
 *
 * @param ms - Duration to sleep in milliseconds. Values ≤ 0 resolve immediately.
 */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// Route exclusion helper
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the given URL path matches any of the excluded route
 * prefixes.
 *
 * Matching is prefix-based and case-sensitive. A trailing slash on the
 * prefix is not required — `/health` excludes `/health`, `/health/`, and
 * `/health/check`.
 *
 * @param pathname    - The incoming request path (e.g. `/api/users`).
 * @param excludeRoutes - Array of path prefixes to exclude.
 */
export function isExcluded(pathname: string, excludeRoutes: readonly string[]): boolean {
  return excludeRoutes.some((prefix) => {
    if (pathname === prefix) return true;
    // Ensure we match the prefix at a path boundary
    return pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`) ||
      pathname.startsWith(prefix);
  });
}
