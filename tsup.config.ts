import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    core: 'src/core.ts',
    types: 'src/types.ts',
    presets: 'src/presets.ts',
    express: 'src/express.ts',
    next: 'src/next.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  treeshake: true,
});
