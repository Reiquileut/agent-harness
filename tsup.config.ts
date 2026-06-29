import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node20',
  // Shebang on the built CLI so `dist/cli.js` is directly executable.
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  splitting: false,
  dts: false,
  shims: false,
  minify: false,
  sourcemap: false,
});
