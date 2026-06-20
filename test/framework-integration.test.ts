import Fastify from 'fastify';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { fastifyChaos } from '../src/fastify.js';
import { honoChaos } from '../src/hono.js';
import type { MiddlewareOptions } from '../src/types.js';

const passOptions: MiddlewareOptions = {
  baseDelay: 0,
  jitter: 0,
  failureRate: 0,
  failureType: 'http-error',
  errorCodes: [503],
};

const failOptions: MiddlewareOptions = {
  ...passOptions,
  failureRate: 1,
};

describe('Fastify integration', () => {
  it('runs as a real onRequest hook and passes successful requests', async () => {
    const app = Fastify();
    app.addHook('onRequest', fastifyChaos(passOptions));
    app.get('/users', async (): Promise<{ users: string[] }> => ({ users: [] }));

    const response = await app.inject({ method: 'GET', url: '/users' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ users: [] });
  });

  it('short-circuits a real request with the configured HTTP error', async () => {
    const app = Fastify();
    app.addHook('onRequest', fastifyChaos(failOptions));
    app.get('/users', async (): Promise<{ users: string[] }> => ({ users: [] }));

    const response = await app.inject({ method: 'GET', url: '/users' });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.headers['x-chaos-injected']).toBe('1');
    expect(response.json()).toEqual({
      error: 'Chaos injected error',
      status: 503,
    });
  });

  it('honors route exclusions in a real Fastify app', async () => {
    const app = Fastify();
    app.addHook(
      'onRequest',
      fastifyChaos({ ...failOptions, excludeRoutes: ['/health'] }),
    );
    app.get('/health', async (): Promise<{ status: string }> => ({
      status: 'ok',
    }));

    const response = await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('Hono integration', () => {
  it('runs as real middleware and passes successful requests', async () => {
    const app = new Hono();
    app.use('*', honoChaos(passOptions));
    app.get('/users', (context) => context.json({ users: [] }));

    const response = await app.request('/users');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ users: [] });
  });

  it('short-circuits a real request with the configured HTTP error', async () => {
    const app = new Hono();
    app.use('*', honoChaos(failOptions));
    app.get('/users', (context) => context.json({ users: [] }));

    const response = await app.request('/users');

    expect(response.status).toBe(503);
    expect(response.headers.get('X-Chaos-Injected')).toBe('1');
    await expect(response.json()).resolves.toEqual({
      error: 'Chaos injected error',
      status: 503,
    });
  });

  it('honors exclusions and represents TCP drops at the edge', async () => {
    const app = new Hono();
    app.use(
      '*',
      honoChaos({
        ...failOptions,
        failureType: 'tcp-drop',
        excludeRoutes: ['/health'],
      }),
    );
    app.get('/health', (context) => context.json({ status: 'ok' }));
    app.get('/users', (context) => context.json({ users: [] }));

    const healthResponse = await app.request('/health');
    const usersResponse = await app.request('/users');

    expect(healthResponse.status).toBe(200);
    expect(usersResponse.status).toBe(503);
    expect(usersResponse.headers.get('X-Chaos-Tcp-Drop')).toBe('1');
  });
});
