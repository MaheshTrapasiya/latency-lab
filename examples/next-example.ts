/**
 * Next.js App Router example for latency-lab.
 *
 * Copy the relevant sections into your Next.js project.
 *
 * Note: This file imports from `latency-lab/next` and uses structural types
 * that are compatible with `next/server` without requiring `next` to be
 * installed as a direct dependency of latency-lab itself.
 */

import { withChaos, presets } from '../src/index.js';
import type { NextRequestLike, NextResponseLike } from '../src/next.js';

// ---------------------------------------------------------------------------
// Simulated NextResponse factory (only needed for this standalone example).
// In a real Next.js project, use `NextResponse.json()` from `next/server`.
// ---------------------------------------------------------------------------

function json(data: unknown, init?: ResponseInit): NextResponseLike {
  const body = JSON.stringify(data);
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  return new Response(body, {
    ...init,
    headers,
  }) as unknown as NextResponseLike;
}

// ---------------------------------------------------------------------------
// Example 1 — GET /api/users — using a preset
// ---------------------------------------------------------------------------
//
// In a real Next.js App Router project this file would be:
//   app/api/users/route.ts
//
// And you would:
//   import { NextRequest, NextResponse } from 'next/server';
//   export const GET = withChaos(handler, presets.slow3g);

async function usersGET(_req: NextRequestLike): Promise<NextResponseLike> {
  return json({
    users: [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
    ],
  });
}

export const GET = withChaos(usersGET, presets.slow3g);

// ---------------------------------------------------------------------------
// Example 2 — POST /api/posts — manual configuration
// ---------------------------------------------------------------------------

async function postsPOST(_req: NextRequestLike): Promise<NextResponseLike> {
  // Simulate a DB write
  const newPost = { id: 99, title: 'New post', createdAt: new Date().toISOString() };
  return json(newPost, { status: 201 });
}

export const POST = withChaos(postsPOST, {
  baseDelay: 250,
  jitter: 120,
  wavePeriod: 15,
  failureRate: 0.06,
  failureType: 'http-error',
  errorCodes: [500, 503],
  excludeRoutes: [], // no exclusions for POST
});

// ---------------------------------------------------------------------------
// Example 3 — Mixed preset + custom overrides + route exclusions
// ---------------------------------------------------------------------------

async function analyticsGET(_req: NextRequestLike): Promise<NextResponseLike> {
  return json({
    pageViews: 12_345,
    sessions: 3_210,
  });
}

export const GET_ANALYTICS = withChaos(analyticsGET, {
  // Spread a preset and override specific fields
  ...presets.congestedStadium,
  failureRate: 0.12,             // lower than stadium default (0.30)
  excludeRoutes: ['/api/health', '/api/ready'],
});

// ---------------------------------------------------------------------------
// Demonstration — call the wrapped handlers directly (no HTTP server needed)
// ---------------------------------------------------------------------------

async function runDemo(): Promise<void> {
  console.warn('latency-lab — Next.js adapter demo\n');

  const req = {
    url: 'https://example.com/api/users',
    method: 'GET',
    headers: new Headers(),
  } satisfies NextRequestLike;

  const ROUNDS = 5;

  for (let i = 1; i <= ROUNDS; i++) {
    const start = Date.now();
    try {
      const res = await GET(req);
      const elapsed = Date.now() - start;
      console.warn(
        `[Round ${i}] status=${res.status} delay=${elapsed}ms` +
          (res.headers.get('X-Chaos-Injected') === '1' ? ' [chaos-error]' : '') +
          (res.headers.get('X-Chaos-Tcp-Drop') === '1' ? ' [tcp-drop-sim]' : ''),
      );
    } catch (err) {
      console.error(`[Round ${i}] Unexpected error:`, err);
    }
  }
}

await runDemo();
