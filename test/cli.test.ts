import { describe, expect, it, vi } from 'vitest';
import {
  cliHelp,
  parseCliArgs,
} from '../src/cli-config.js';
import { runCli } from '../src/cli.js';

describe('parseCliArgs', () => {
  it('handles help and version without requiring a target', () => {
    expect(parseCliArgs(['--help'], {})).toEqual({ action: 'help' });
    expect(parseCliArgs(['-v'], {})).toEqual({ action: 'version' });
    expect(cliHelp).toContain('--target');
  });

  it('uses safe defaults with the flakyCafeWifi preset', () => {
    const result = parseCliArgs(['--target', 'http://localhost:3000'], {});
    expect(result.action).toBe('run');
    if (result.action !== 'run') return;

    expect(result.config.host).toBe('127.0.0.1');
    expect(result.config.port).toBe(4000);
    expect(result.config.quiet).toBe(false);
    expect(result.config.chaos.baseDelay).toBe(150);
  });

  it('reads every supported environment variable', () => {
    const result = parseCliArgs([], {
      LATENCY_LAB_TARGET: 'https://api.example.com/base',
      LATENCY_LAB_HOST: '0.0.0.0',
      LATENCY_LAB_PORT: '4100',
      LATENCY_LAB_PRESET: 'slow3g',
      LATENCY_LAB_BASE_DELAY: '10',
      LATENCY_LAB_JITTER: '20',
      LATENCY_LAB_WAVE_PERIOD: '30',
      LATENCY_LAB_FAILURE_RATE: '0.4',
      LATENCY_LAB_FAILURE_TYPE: 'tcp-drop',
      LATENCY_LAB_ERROR_CODES: '502,503',
      LATENCY_LAB_EXCLUDE_ROUTES: '/health,/metrics',
      LATENCY_LAB_QUIET: 'true',
    });
    if (result.action !== 'run') throw new Error('Expected run config');

    expect(result.config).toMatchObject({
      host: '0.0.0.0',
      port: 4100,
      quiet: true,
      chaos: {
        baseDelay: 10,
        jitter: 20,
        wavePeriod: 30,
        failureRate: 0.4,
        failureType: 'tcp-drop',
        errorCodes: [502, 503],
        excludeRoutes: ['/health', '/metrics'],
      },
    });
    expect(result.config.target.href).toBe('https://api.example.com/base');
  });

  it('gives CLI flags precedence over environment variables', () => {
    const result = parseCliArgs(
      [
        '--target', 'http://cli.example.com',
        '--port', '4200',
        '--preset', 'corpVPN',
        '--base-delay', '5',
        '--exclude-route', '/one',
        '--exclude-route', '/two',
        '--quiet',
      ],
      {
        LATENCY_LAB_TARGET: 'http://env.example.com',
        LATENCY_LAB_PORT: '4100',
        LATENCY_LAB_BASE_DELAY: '100',
        LATENCY_LAB_EXCLUDE_ROUTES: '/env',
        LATENCY_LAB_QUIET: 'false',
      },
    );
    if (result.action !== 'run') throw new Error('Expected run config');

    expect(result.config.target.hostname).toBe('cli.example.com');
    expect(result.config.port).toBe(4200);
    expect(result.config.chaos.baseDelay).toBe(5);
    expect(result.config.chaos.excludeRoutes).toEqual(['/one', '/two']);
    expect(result.config.quiet).toBe(true);
  });

  it.each([
    [[], {}, 'required'],
    [['--target', 'relative'], {}, 'absolute URL'],
    [['--target', 'ftp://example.com'], {}, 'http: or https:'],
    [['--target', 'http://localhost', '--preset', 'unknown'], {}, 'Unknown preset'],
    [['--target', 'http://localhost', '--port', '70000'], {}, 'port'],
    [['--target', 'http://localhost', '--failure-rate', 'many'], {}, 'finite'],
    [['--target', 'http://localhost', '--failure-type', 'explode'], {}, 'failure-type'],
    [['--target', 'http://localhost', '--host', ''], {}, 'host'],
    [[], { LATENCY_LAB_TARGET: 'http://localhost', LATENCY_LAB_QUIET: 'maybe' }, 'QUIET'],
    [['--unknown'], {}, 'Unknown option'],
  ])('rejects invalid CLI configuration', (args, env, message) => {
    expect(() => parseCliArgs(args, env)).toThrow(message);
  });
});

describe('runCli', () => {
  it('prints help and version without starting a proxy', async () => {
    const output: string[] = [];
    const io = {
      out: (message: string): void => {
        output.push(message);
      },
      error: vi.fn(),
    };

    expect(await runCli(['--help'], {}, io)).toBeNull();
    expect(await runCli(['--version'], {}, io)).toBeNull();
    expect(output[0]).toContain('Usage:');
    expect(output[1]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('starts a real ephemeral proxy and reports its address', async () => {
    const output: string[] = [];
    const proxy = await runCli(
      [
        '--target', 'http://127.0.0.1:65534',
        '--port', '0',
        '--base-delay', '0',
        '--jitter', '0',
        '--failure-rate', '1',
        '--failure-type', 'http-error',
        '--error-codes', '503',
        '--quiet',
      ],
      {},
      {
        out: (message: string): void => {
          output.push(message);
        },
        error: vi.fn(),
      },
    );

    expect(proxy).not.toBeNull();
    expect(output[0]).toContain('proxy listening');
    if (proxy !== null) {
      expect((await fetch(proxy.url)).status).toBe(503);
      await proxy.close();
    }
  });
});
