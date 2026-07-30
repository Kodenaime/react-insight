import { defineConfig } from 'tsup';

export default defineConfig([
  // Main server handler
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: true,
    external: ['launch-editor'],
    sourcemap: true,
  },
  // Plugin subpath exports
  {
    entry: { vite: 'src/vite.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: false,
    external: ['vite'],
    sourcemap: true,
  },
  {
    entry: { webpack: 'src/webpack.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: false,
    external: ['webpack'],
    sourcemap: true,
  },
  {
    entry: { nextjs: 'src/nextjs.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: false,
    external: ['next'],
    sourcemap: true,
  },
]);
