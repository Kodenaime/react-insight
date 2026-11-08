import { writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';

/**
 * Atomically write JSON to disk: write to a temp file in the same directory,
 * then rename over the target. A concurrent reader never sees a partial file.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const abs = resolve(filePath);
  const dir = dirname(abs);
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true });

  const tempPath = join(
    dir,
    `.diagnostics.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tempPath, abs);
}
