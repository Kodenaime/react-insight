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
  // Pure, environment-agnostic subpaths (browser + Node). The MCP server
  // imports the SAME masker and schema via `react-insight/security` and
  // `react-insight/schema`, so the trust boundary is not duplicated.
  {
    entry: { security: 'src/security/masker.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: false,
  },
  {
    entry: { schema: 'src/export/schema.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: false,
  },
]);
