# Contributing to latency-lab

Thanks for helping improve latency-lab. Bug reports, documentation fixes, new
adapters, presets, and focused feature contributions are welcome.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Open an issue before starting a large API or behavior change.
- Never include credentials, private endpoints, or production data in an issue,
  test, fixture, or commit.

## Local development

latency-lab requires Node.js 18 or newer.

```bash
git clone https://github.com/MaheshTrapasiya/latency-lab.git
cd latency-lab
npm ci
npm run typecheck
npm run lint
npm run test:coverage
npm run test:package
```

Keep the package free of runtime dependencies. Development dependencies are
acceptable when they materially improve testing or maintenance.

## Pull requests

1. Fork the repository and create a focused branch.
2. Add tests for every behavior change and regression fix.
3. Update the README and changelog when public behavior changes.
4. Run the complete verification commands above.
5. Submit a pull request that explains the problem, solution, and validation.

Maintainers control release markers and versioning. Contributor commits should
not add `[major]` or `[minor]` markers.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting security issues

Do not open a public issue for a vulnerability. Follow the private reporting
instructions in [SECURITY.md](SECURITY.md).
