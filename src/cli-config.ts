import { parseArgs } from 'node:util';
import { validateChaosOptions } from './core.js';
import { presets } from './presets.js';
import type { PresetName } from './presets.js';
import type { FailureType, MiddlewareOptions } from './types.js';

export interface CliConfig {
  target: URL;
  host: string;
  port: number;
  chaos: MiddlewareOptions;
  quiet: boolean;
}

export type CliParseResult =
  | { action: 'help' }
  | { action: 'version' }
  | { action: 'run'; config: CliConfig };

export class CliConfigError extends Error {
  override readonly name = 'CliConfigError';
}

const optionDefinitions = {
  target: { type: 'string', short: 't' },
  host: { type: 'string' },
  port: { type: 'string', short: 'p' },
  preset: { type: 'string' },
  'base-delay': { type: 'string' },
  jitter: { type: 'string' },
  'wave-period': { type: 'string' },
  'failure-rate': { type: 'string' },
  'failure-type': { type: 'string' },
  'error-codes': { type: 'string' },
  'exclude-route': { type: 'string', multiple: true },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

export const cliHelp = `Usage:
  latency-lab --target <url> [options]

Options:
  -t, --target <url>          Upstream HTTP/HTTPS server (required)
  -p, --port <number>         Proxy port (default: 4000)
      --host <host>           Proxy host (default: 127.0.0.1)
      --preset <name>         Network preset (default: flakyCafeWifi)
      --base-delay <ms>       Override base delay
      --jitter <ms>           Override jitter
      --wave-period <sec>     Override wave period
      --failure-rate <0..1>   Override failure probability
      --failure-type <type>   http-error, tcp-drop, or random
      --error-codes <list>    Comma-separated HTTP status codes
      --exclude-route <path>  Route prefix to bypass (repeatable)
  -q, --quiet                 Disable per-request logs
  -h, --help                  Show help
  -v, --version               Show version
`;

function valueFrom(
  cliValue: string | undefined,
  env: NodeJS.ProcessEnv,
  envName: string,
): string | undefined {
  return cliValue ?? env[envName];
}

function finiteNumber(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliConfigError(name + ' must be a finite number.');
  }
  return parsed;
}

function portNumber(value: string): number {
  const port = finiteNumber('port', value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new CliConfigError('port must be an integer in [0, 65535].');
  }
  return port;
}

function booleanValue(name: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new CliConfigError(name + ' must be true, false, 1, or 0.');
}

function presetOptions(name: string): MiddlewareOptions {
  if (!(name in presets)) {
    throw new CliConfigError(
      'Unknown preset "' + name + '". Available: ' +
        Object.keys(presets).join(', '),
    );
  }
  const preset = presets[name as PresetName];
  return { ...preset, errorCodes: [...preset.errorCodes] };
}

function parseErrorCodes(value: string): number[] {
  return value
    .split(',')
    .map((entry) => finiteNumber('error-codes', entry));
}

function parseFailureType(value: string): FailureType {
  if (!['http-error', 'tcp-drop', 'random'].includes(value)) {
    throw new CliConfigError(
      'failure-type must be http-error, tcp-drop, or random.',
    );
  }
  return value as FailureType;
}

function targetUrl(value: string | undefined): URL {
  if (value === undefined) {
    throw new CliConfigError('--target or LATENCY_LAB_TARGET is required.');
  }
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new CliConfigError('target must be a valid absolute URL.');
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new CliConfigError('target must use http: or https:.');
  }
  return target;
}

export function parseCliArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): CliParseResult {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: optionDefinitions,
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new CliConfigError(
      error instanceof Error ? error.message : String(error),
    );
  }

  if (values.help === true) return { action: 'help' };
  if (values.version === true) return { action: 'version' };

  const presetName =
    valueFrom(values.preset, env, 'LATENCY_LAB_PRESET') ??
    'flakyCafeWifi';
  const chaos = presetOptions(presetName);

  const baseDelay = valueFrom(
    values['base-delay'],
    env,
    'LATENCY_LAB_BASE_DELAY',
  );
  const jitter = valueFrom(values.jitter, env, 'LATENCY_LAB_JITTER');
  const wavePeriod = valueFrom(
    values['wave-period'],
    env,
    'LATENCY_LAB_WAVE_PERIOD',
  );
  const rate = valueFrom(
    values['failure-rate'],
    env,
    'LATENCY_LAB_FAILURE_RATE',
  );
  const type = valueFrom(
    values['failure-type'],
    env,
    'LATENCY_LAB_FAILURE_TYPE',
  );
  const codes = valueFrom(
    values['error-codes'],
    env,
    'LATENCY_LAB_ERROR_CODES',
  );

  if (baseDelay !== undefined) {
    chaos.baseDelay = finiteNumber('base-delay', baseDelay);
  }
  if (jitter !== undefined) chaos.jitter = finiteNumber('jitter', jitter);
  if (wavePeriod !== undefined) {
    chaos.wavePeriod = finiteNumber('wave-period', wavePeriod);
  }
  if (rate !== undefined) {
    chaos.failureRate = finiteNumber('failure-rate', rate);
  }
  if (type !== undefined) chaos.failureType = parseFailureType(type);
  if (codes !== undefined) chaos.errorCodes = parseErrorCodes(codes);

  const envRoutes = env['LATENCY_LAB_EXCLUDE_ROUTES'];
  const routes =
    values['exclude-route'] ??
    (envRoutes === undefined
      ? undefined
      : envRoutes.split(',').filter((route) => route.length > 0));
  if (routes !== undefined) chaos.excludeRoutes = routes;

  validateChaosOptions(chaos);

  const target = targetUrl(
    valueFrom(values.target, env, 'LATENCY_LAB_TARGET'),
  );
  const host =
    valueFrom(values.host, env, 'LATENCY_LAB_HOST') ?? '127.0.0.1';
  if (host.length === 0) throw new CliConfigError('host cannot be empty.');
  const port = portNumber(
    valueFrom(values.port, env, 'LATENCY_LAB_PORT') ?? '4000',
  );
  const quiet =
    values.quiet === true ||
    booleanValue('LATENCY_LAB_QUIET', env['LATENCY_LAB_QUIET']);

  return {
    action: 'run',
    config: { target, host, port, chaos, quiet },
  };
}
