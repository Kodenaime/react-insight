import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: true,
    platform: 'node',
    target: 'node18',
    external: ['react-insight', 'react-insight/*'],
    sourcemap: true,
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    outDir: 'dist',
    clean: false,
    platform: 'node',
    target: 'node18',
    external: ['react-insight', 'react-insight/*'],
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { 'browser-client': 'src/browser-client.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: false,
    platform: 'neutral',
    target: 'es2020',
  },
]);
