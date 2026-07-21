/**
 * capture-all.mjs
 *
 * Orchestrator: install deps and run the capture script for each React version.
 * Each sub-project is self-contained (its own node_modules + React version).
 *
 * Usage: node scripts/fixture-capture/capture-all.mjs
 * Or:    pnpm fixtures:capture
 */

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const versions = ['r17', 'r18', 'r19'];

console.log('═══ React Insight — Fiber Fixture Capture ═══');
console.log();

for (const v of versions) {
  const dir = resolve(__dirname, v);

  console.log(`▸ ${v}: ensuring dependencies installed…`);
  if (!existsSync(resolve(dir, 'node_modules', 'react'))) {
    execSync('npm install --ignore-scripts --no-audit --no-fund', {
      cwd: dir,
      stdio: 'inherit',
    });
  }

  console.log(`▸ ${v}: capturing fiber tree…`);
  try {
    execSync('node --conditions=development capture-r' + v.slice(1) + '.mjs', {
      cwd: dir,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error(`  ✗ ${v} capture failed: ${err.message}`);
    process.exitCode = 1;
  }

  console.log();
}

console.log('═══ Done ═══');
