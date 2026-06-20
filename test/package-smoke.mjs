import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const publicSubpaths = [
  'latency-lab',
  'latency-lab/core',
  'latency-lab/express',
  'latency-lab/next',
  'latency-lab/fastify',
  'latency-lab/hono',
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
assert.equal(typeof root.presets.satelliteLink, 'object');

const metadata = require('latency-lab/package.json');
assert.equal(metadata.name, 'latency-lab');

console.log('Package ESM, CJS, subpath, and metadata exports verified');
