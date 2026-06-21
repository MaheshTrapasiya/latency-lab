#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { cliHelp, parseCliArgs } from './cli-config.js';
import { createChaosProxy } from './proxy.js';
import type { ChaosProxy } from './proxy.js';

export interface CliIo {
  out(message: string): void;
  error(message: string): void;
}

const defaultIo: CliIo = {
  out: (message): void => {
    process.stdout.write(message + '\n');
  },
  error: (message): void => {
    console.error(message);
  },
};

async function packageVersion(): Promise<string> {
  const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return metadata.version;
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = defaultIo,
): Promise<ChaosProxy | null> {
  const parsed = parseCliArgs(args, env);
  if (parsed.action === 'help') {
    io.out(cliHelp);
    return null;
  }
  if (parsed.action === 'version') {
    io.out(await packageVersion());
    return null;
  }

  const proxy = await createChaosProxy({
    ...parsed.config,
    logger: io.out,
  });
  io.out(
    '[latency-lab] proxy listening on ' + proxy.url + ' -> ' +
      parsed.config.target.href,
  );
  return proxy;
}

async function main(): Promise<void> {
  try {
    const proxy = await runCli();
    if (proxy === null) return;

    let closing = false;
    const shutdown = (): void => {
      if (closing) return;
      closing = true;
      void proxy.close().then(
        () => {
          process.exitCode = 0;
        },
        (error: unknown) => {
          console.error(error);
          process.exitCode = 1;
        },
      );
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('latency-lab: ' + message);
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(entryPath).href
) {
  void main();
}
