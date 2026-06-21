import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const publicSubpaths = [
  'latency-lab',
  'latency-lab/core',
  'latency-lab/express',
  'latency-lab/next',
  'latency-lab/fastify',
  'latency-lab/hono',
  'latency-lab/fetch',
  'latency-lab/presets',
  'latency-lab/types',
];

for (const subpath of publicSubpaths) {
  const imported = await import(subpath);
  assert.ok(Object.keys(imported).length > 0, `Empty ESM export: ${subpath}`);
}

const require = createRequire(import.meta.url);
for (const subpath of publicSubpaths) {
  const imported = require(subpath);
  assert.ok(Object.keys(imported).length > 0, `Empty CJS export: ${subpath}`);
}

const root = await import('latency-lab');
assert.equal(typeof root.decideChaos, 'function');
assert.equal(typeof root.chaosMiddleware, 'function');
assert.equal(typeof root.withChaos, 'function');
assert.equal(typeof root.fastifyChaos, 'function');
assert.equal(typeof root.honoChaos, 'function');
assert.equal(typeof root.createChaosFetch, 'function');
assert.equal(typeof root.installFetchChaos, 'function');
assert.equal(typeof root.presets.satelliteLink, 'object');

const metadata = require('latency-lab/package.json');
assert.equal(metadata.name, 'latency-lab');
assert.equal(metadata.bin['latency-lab'], './dist/cli.js');

const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const help = execFileSync(process.execPath, [cliPath, '--help'], {
  encoding: 'utf8',
});
const version = execFileSync(process.execPath, [cliPath, '--version'], {
  encoding: 'utf8',
});
assert.match(help, /--target/);
assert.match(version.trim(), /^\d+\.\d+\.\d+$/);

const child = spawn(
  process.execPath,
  [
    cliPath,
    '--target', 'http://127.0.0.1:65534',
    '--port', '0',
    '--base-delay', '0',
    '--jitter', '0',
    '--failure-rate', '1',
    '--failure-type', 'http-error',
    '--error-codes', '503',
    '--quiet',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error('CLI did not start in time: ' + stderr));
  }, 5000);
  const checkStarted = () => {
    if (stdout.includes('proxy listening')) {
      clearTimeout(timeout);
      child.stdout.off('data', checkStarted);
      resolve();
    }
  };
  child.stdout.on('data', checkStarted);
  child.once('error', reject);
});

const exited = new Promise((resolve, reject) => {
  child.once('exit', (code, signal) => resolve({ code, signal }));
  child.once('error', reject);
});
child.kill('SIGTERM');
const exit = await exited;
assert.ok(
  exit.code === 0 || exit.signal !== null,
  'CLI failed to shut down: ' + stderr,
);

console.log('Package ESM, CJS, subpath, and metadata exports verified');
