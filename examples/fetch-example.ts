import {
  createChaosFetch,
  installFetchChaos,
  presets,
} from 'latency-lab';

const degradedFetch = createChaosFetch({
  ...presets.mobileDataRoaming,
  includeUrls: ['https://api.example.com/'],
  excludeUrls: ['https://api.example.com/health'],
});

const response = await degradedFetch('https://api.example.com/users');
console.log(await response.json());

const installation = installFetchChaos(presets.flakyCafeWifi);
try {
  await fetch('https://third-party.example.com/data');
} finally {
  installation.restore();
}
