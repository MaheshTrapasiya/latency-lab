# Changelog

## [1.2.2] - 2026-06-21

### Documentation

- Improved npm and README discovery metadata for network latency simulation,
  HTTP fault injection, Fetch interception, framework middleware, and proxy
  testing use cases.
- Added task-oriented outage, timeout, retry, and language-agnostic proxy
  recipes.
- Added `llms.txt` as a concise machine-readable project and API index.

## [1.2.1] - 2026-06-21

### Security

- Updated the development test toolchain to patched Vitest, Vite, and esbuild
  versions with zero known npm vulnerabilities.
- Enabled explicit workflow permissions and hardened release URL handling.
- Removed reflected request data from the proxy integration test response.

### Added

- Contributor guide, security policy, code of conduct, issue forms, pull
  request template, and Dependabot configuration.
- Automatic GitHub tags and releases after successful npm publishing.

## [1.2.0] - 2026-06-21

### Added

- Outbound Fetch chaos through `createChaosFetch()` and
  `installFetchChaos()`.
- URL inclusion/exclusion filters, abort-aware delays, synthetic HTTP errors,
  and typed TCP-drop failures for Fetch.
- Zero-code `latency-lab` CLI reverse proxy for HTTP and HTTPS targets.
- CLI flags and `LATENCY_LAB_*` environment configuration with preset
  overrides and per-request logging.

### Changed

- Release publishing supports explicit `[minor]` and `[major]` commit
  markers while defaulting to patch releases.
- Manual workflow runs can select patch, minor, or major version bumps.
- Successful publishes commit the released version back to `package.json` and
  `package-lock.json`.

## [1.1.1] - 2026-06-20

### Changed

- Added real Fastify and Hono integration tests.
- Added ESM, CommonJS, subpath export, and npm package smoke tests.
- Raised enforced coverage thresholds to protect published behavior.
- Expanded malformed configuration and adapter edge-case coverage.

## [1.1.0] - 2026-06-20

### Added

- Fastify support through `fastifyChaos()` from `latency-lab/fastify`.
- Hono support through `honoChaos()` from `latency-lab/hono`.
- Public `decideChaos()` API and typed `ChaosDecision` outcomes for custom
  adapters.
- Three network presets: `satelliteLink`, `mobileDataRoaming`, and
  `corpVPN`.
- ESM, CommonJS, and declaration exports for the Fastify and Hono subpaths.
- Deterministic coverage for the shared decision engine and both new adapters.

### Changed

- Express and Next.js adapters now use the shared decision engine while
  preserving their existing public APIs.
- Package metadata now declares Fastify and Hono as optional peer dependencies.
- Documentation includes installation, usage, and API examples for all
  supported frameworks.

### Compatibility

- No breaking API changes.
- Node.js 18 and newer remain supported.
- Fastify 4 and 5 are supported.
- Hono 4 is supported.
