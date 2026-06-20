import { readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';

const packageJsonPath = new URL('../package.json', import.meta.url);
const packageLockPath = new URL('../package-lock.json', import.meta.url);
const releaseType = process.env.VERSION_BUMP ?? process.argv[2] ?? 'patch';

if (!['major', 'minor', 'patch'].includes(releaseType)) {
  throw new Error(
    `VERSION_BUMP must be "major", "minor", or "patch", got: ${releaseType}`,
  );
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version);
  if (match === null) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);

  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  );
}

function nextVersion(version, type) {
  const parsed = parseVersion(version);

  if (type === 'major') {
    return `${parsed.major + 1}.0.0`;
  }
  if (type === 'minor') {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function registryPackageUrl(packageName) {
  return `https://registry.npmjs.org/${packageName.replace('/', '%2f')}/latest`;
}

function readRegistryVersion(packageName) {
  return new Promise((resolve, reject) => {
    https
      .get(registryPackageUrl(packageName), (response) => {
        let body = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode === 404) {
            resolve(null);
            return;
          }

          if (response.statusCode === undefined || response.statusCode >= 400) {
            reject(
              new Error(
                `npm registry returned ${response.statusCode ?? 'unknown status'}`,
              ),
            );
            return;
          }

          const metadata = JSON.parse(body);
          resolve(typeof metadata.version === 'string' ? metadata.version : null);
        });
      })
      .on('error', reject);
  });
}

async function writeJson(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const packageLock = JSON.parse(await readFile(packageLockPath, 'utf8'));

const publishedVersion = await readRegistryVersion(packageJson.name);
const baseVersion =
  publishedVersion !== null &&
  compareVersions(publishedVersion, packageJson.version) > 0
    ? publishedVersion
    : packageJson.version;
const bumpedVersion = nextVersion(baseVersion, releaseType);

packageJson.version = bumpedVersion;
packageLock.version = bumpedVersion;

if (packageLock.packages?.[''] !== undefined) {
  packageLock.packages[''].version = bumpedVersion;
}

await writeJson(packageJsonPath, packageJson);
await writeJson(packageLockPath, packageLock);

console.log(`Version bumped to ${bumpedVersion} (${releaseType})`);
