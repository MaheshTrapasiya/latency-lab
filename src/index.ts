/**
 * latency-lab — Inject realistic network chaos into backend applications.
 *
 * Public API surface. Import from the package root for access to everything,
 * or use sub-path imports for tree-shaking:
 *
 * ```ts
 * // Everything
 * import {
 *   chaosMiddleware,
 *   fastifyChaos,
 *   honoChaos,
 *   withChaos,
 *   presets,
 * } from 'latency-lab';
 *
 * // Core only (zero-dep chaos engine)
 * import { calculateDelay, shouldFail, sleep } from 'latency-lab/core';
 *
 * // Express adapter only
 * import { chaosMiddleware } from 'latency-lab/express';
 *
 * // Next.js adapter only
 * import { withChaos } from 'latency-lab/next';
 *
 * // Fastify onRequest hook
 * import { fastifyChaos } from 'latency-lab/fastify';
 *
 * // Hono middleware
 * import { honoChaos } from 'latency-lab/hono';
 *
 * // Presets only
 * import { presets } from 'latency-lab/presets';
 * ```
 */

export * from './types.js';
export * from './core.js';
export * from './presets.js';
export * from './express.js';
export * from './next.js';
export * from './fastify.js';
export * from './hono.js';
