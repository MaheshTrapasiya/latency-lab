/**
 * How a simulated failure is expressed to the client.
 *
 * - `'http-error'`  — Respond with an HTTP error status code drawn from `errorCodes`.
 * - `'tcp-drop'`    — Approximate a TCP connection drop by destroying the socket
 *                     (Express) or returning a 503 (Next.js, where true socket
 *                     destruction is unavailable in App Router handlers).
 * - `'random'`      — Randomly choose between `'http-error'` and `'tcp-drop'`
 *                     each time a failure occurs.
 */
export type FailureType = 'http-error' | 'tcp-drop' | 'random';

/**
 * Resolved failure type after `'random'` has been evaluated.
 * Never `'random'` — always a concrete action.
 */
export type ResolvedFailureType = Exclude<FailureType, 'random'>;

/** Resolved action for one request after all randomness has been evaluated. */
export type ChaosDecision =
  | { outcome: 'pass'; delay: number }
  | { outcome: 'http-error'; delay: number; statusCode: number }
  | { outcome: 'tcp-drop'; delay: number };

/** Route matcher used by middleware-level request filters. */
export type RouteMatcher = string | RegExp;

/**
 * Core chaos configuration.
 *
 * All time values are in **milliseconds** unless otherwise noted.
 */
export interface ChaosOptions {
  /**
   * Base latency added to every request in milliseconds.
   * Must be ≥ 0.
   */
  baseDelay: number;

  /**
   * Maximum magnitude of random jitter added to or subtracted from
   * `baseDelay` in milliseconds. Must be ≥ 0.
   *
   * Actual jitter per request is sampled uniformly from `[-jitter, +jitter]`.
   */
  jitter: number;

  /**
   * Period of a sine-wave fluctuation applied on top of jitter, in **seconds**.
   *
   * This simulates slowly oscillating network quality (e.g., a roaming device
   * moving in and out of signal). When omitted, no wave fluctuation is applied.
   *
   * Must be > 0 when provided.
   */
  wavePeriod?: number;

  /**
   * Probability that a given request results in a simulated failure.
   * Must be in the range [0, 1].
   *
   * - `0`   → failures never occur
   * - `1`   → every request fails
   * - `0.1` → ~10% of requests fail
   */
  failureRate: number;

  /**
   * Determines how simulated failures are expressed to callers.
   */
  failureType: FailureType;

  /**
   * Pool of HTTP status codes to choose from when responding with an HTTP error.
   * Must contain at least one entry.
   *
   * Only used when `failureType` resolves to `'http-error'`.
   */
  errorCodes: number[];
}

/**
 * Options passed to framework-level middleware / handler wrappers.
 * Extends `ChaosOptions` with request-filtering capabilities.
 */
export interface MiddlewareOptions extends ChaosOptions {
  /**
   * Optional allow-list of URL path prefixes or regular expressions.
   *
   * When provided, chaos is applied only to matching routes unless a `routes`
   * override matches first. `excludeRoutes` always wins.
   *
   * Matching is prefix-based for strings and case-sensitive.
   *
   * @example
   * includeRoutes: ['/api']
   */
  includeRoutes?: RouteMatcher[];

  /**
   * List of URL path prefixes or regular expressions that should bypass chaos
   * injection entirely.
   *
   * Matching is prefix-based for strings and case-sensitive.
   *
   * @example
   * excludeRoutes: ['/health', '/metrics', '/_next']
   */
  excludeRoutes?: RouteMatcher[];

  /**
   * Per-route overrides checked before the default chaos options.
   *
   * Use `chaos: false` to explicitly bypass a matched route.
   */
  routes?: RouteChaosConfig[];
}

/** Per-route chaos override for middleware and proxy adapters. */
export interface RouteChaosConfig {
  /** URL path prefix or regular expression to match. */
  match: RouteMatcher;
  /** Chaos options for this route, or `false` to bypass it. */
  chaos: ChaosOptions | false;
}

/**
 * Named scenario shape for team-shared latency-lab configuration files.
 */
export interface ChaosScenario {
  /** Stable scenario name, suitable for config keys or CLI labels. */
  name: string;
  /** Optional human-readable explanation for teammates. */
  description?: string;
  /** Base chaos behavior for the scenario. */
  chaos: ChaosOptions;
  /** Optional route allow-list for the scenario. */
  includeRoutes?: RouteMatcher[];
  /** Optional route deny-list for the scenario. */
  excludeRoutes?: RouteMatcher[];
  /** Optional per-route overrides for the scenario. */
  routes?: RouteChaosConfig[];
}

/**
 * Structured error thrown when a `ChaosOptions` or `MiddlewareOptions`
 * object fails validation.
 */
export class ChaosConfigError extends Error {
  override readonly name = 'ChaosConfigError';

  constructor(message: string) {
    super(message);
    // Maintain proper prototype chain in transpiled output
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
