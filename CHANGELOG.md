# Changelog

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
