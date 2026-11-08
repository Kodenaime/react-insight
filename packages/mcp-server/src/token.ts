import { randomBytes } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

/** Generate a 32-byte random token as a 64-char lowercase hex string. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Write the bridge token to disk so the dev-server plugin (or a manual setup)
 * can inject it into the page. The target directory is created if needed.
 */
export function writeTokenFile(filePath: string, token: string): void {
  const abs = resolve(filePath);
  const dir = dirname(abs);
  if (dir && dir !== '.') {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(abs, token, 'utf8');
}
