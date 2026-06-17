import type { ChaosOptions } from './types.js';

// ---------------------------------------------------------------------------
// Named network condition presets
// ---------------------------------------------------------------------------

/**
 * Simulates a subway tunnel or underground environment.
 *
 * Characteristics:
 * - Very high base latency
 * - Significant jitter (signal drops and recovers)
 * - Fast sine-wave cycle (8 s) — connection oscillates rapidly
 * - High failure rate with TCP drops (abrupt disconnection)
 */
const subwayTunnel: Readonly<ChaosOptions> = Object.freeze({
  baseDelay: 800,
  jitter: 600,
  wavePeriod: 8,
  failureRate: 0.2,
  failureType: 'tcp-drop',
  errorCodes: [503, 504],
} satisfies ChaosOptions);

/**
 * Simulates a flaky café Wi-Fi connection.
 *
 * Characteristics:
 * - Moderate base latency (mostly usable)
 * - High burst jitter (sudden quality drops)
 * - Medium wave period (20 s) — quality drifts slowly
 * - Low-to-moderate failure rate, mixed failure types
 */
const flakyCafeWifi: Readonly<ChaosOptions> = Object.freeze({
  baseDelay: 150,
  jitter: 300,
  wavePeriod: 20,
  failureRate: 0.08,
  failureType: 'random',
  errorCodes: [502, 503, 504],
} satisfies ChaosOptions);

/**
 * Simulates a classic slow 3G mobile connection.
 *
 * Characteristics:
 * - High base latency (~400 ms RTT)
 * - Low jitter (3G is slow but predictable)
 * - Long wave period (60 s) — signal quality shifts gradually
 * - Low failure rate, HTTP errors only (timeouts / service unavailable)
 */
const slow3g: Readonly<ChaosOptions> = Object.freeze({
  baseDelay: 400,
  jitter: 100,
  wavePeriod: 60,
  failureRate: 0.03,
  failureType: 'http-error',
  errorCodes: [408, 503],
} satisfies ChaosOptions);

/**
 * Simulates a heavily congested stadium or event venue network.
 *
 * Characteristics:
 * - High base latency (hundreds of users sharing bandwidth)
 * - Extremely high jitter (burst congestion causes wild swings)
 * - Very short wave period (5 s) — network quality ping-pongs rapidly
 * - Very high failure rate, all failure types possible
 */
const congestedStadium: Readonly<ChaosOptions> = Object.freeze({
  baseDelay: 600,
  jitter: 800,
  wavePeriod: 5,
  failureRate: 0.3,
  failureType: 'random',
  errorCodes: [429, 503, 504, 520],
} satisfies ChaosOptions);

/**
 * Collection of all built-in network chaos presets.
 *
 * All values are `readonly` — spread them to extend:
 *
 * @example
 * ```ts
 * import { presets } from 'latency-lab';
 *
 * const myOptions = {
 *   ...presets.slow3g,
 *   failureRate: 0.15,
 *   excludeRoutes: ['/health'],
 * };
 * ```
 */
export const presets = Object.freeze({
  subwayTunnel,
  flakyCafeWifi,
  slow3g,
  congestedStadium,
} as const);

export type PresetName = keyof typeof presets;
