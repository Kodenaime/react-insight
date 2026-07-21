import { defineConfig } from 'tsup';

export default defineConfig([
  // Development build
  {
    entry: { dev: 'src/index.tsx' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: true,
    external: ['react', 'react-dom'],
    sourcemap: true,
    esbuildOptions(opts) {
      opts.jsx = 'automatic';
    },
  },
  // Production build — noop shell
  {
    entry: { production: 'src/production.tsx' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: false,
    external: ['react', 'react-dom'],
    esbuildOptions(opts) {
      opts.jsx = 'automatic';
    },
  },
]);
