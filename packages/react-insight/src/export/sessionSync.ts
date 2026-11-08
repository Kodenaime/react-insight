/**
 * Session File Sync — debounced atomic writes of DiagnosticReportV1.
 *
 * This is the file-based path for coding agents that operate headlessly:
 * while the app runs in a browser tab, the engine can optionally write the
 * current masked report to a file on disk. Agents read the file; they never
 * need to attach to the live browser.
 *
 * ## Design constraints
 *
 * 1. **Debounced:** Writes happen at most every `debounceMs` (default 2000ms).
 *    High-frequency re-render loops must not thrash the disk.
 *
 * 2. **Atomic:** Write to a temp file in the SAME directory, then rename over
 *    the target path. A concurrent reader never observes a partially-written
 *    JSON file — it sees either the previous complete file or the new one.
 *
 * 3. **Masked:** The report is built via jsonExporter.buildDiagnosticReport,
 *    which routes every value through the masker pipeline. No unmasked path.
 */

import { writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import type { ComponentHistory } from '../engine/instanceTracker';
import type { HealthScore } from '../engine/healthEngine';
import { buildDiagnosticReport } from './jsonExporter';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface FileSyncOptions {
  /** Target file path. Default: '.react-insight/diagnostics.json' */
  path?: string;
  /** Debounce interval in ms. Default: 2000 */
  debounceMs?: number;
  /** Callback invoked with the current histories + health score on flush. */
  getSnapshot?: () => { histories: ComponentHistory[]; healthScore: HealthScore };
}

export interface FileSyncHandle {
  /** Trigger a sync (debounced — not immediate). */
  sync: () => void;
  /** Force an immediate sync, bypassing the debounce. */
  flush: () => void;
  /** Stop syncing and clear the pending timer. */
  stop: () => void;
  /** @internal — number of writes actually performed (for tests). */
  _writeCount: () => number;
}

// ─────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────

const DEFAULT_PATH = '.react-insight/diagnostics.json';
const DEFAULT_DEBOUNCE_MS = 2000;

/**
 * Enable debounced, atomic file sync of the masked diagnostic report.
 *
 * @param options - Configuration.
 * @returns A handle with sync/flush/stop controls.
 */
export function enableFileSync(options: FileSyncOptions = {}): FileSyncHandle {
  const targetPath = options.path || DEFAULT_PATH;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let writeCount = 0;

  // ── Atomic write ───────────────────────────────────────────
  function performWrite(): void {
    const snapshot = options.getSnapshot?.();
    if (!snapshot) return;

    const report = buildDiagnosticReport(snapshot.histories, snapshot.healthScore);
    const json = JSON.stringify(report, null, 2);

    const dir = dirname(targetPath);
    // Ensure the directory exists (e.g. .react-insight/)
    if (dir && dir !== '.') {
      mkdirSync(dir, { recursive: true });
    }

    // Write to temp file in the SAME directory, then rename.
    // renameSync is atomic on the same filesystem.
    const tempPath = join(dir, `.diagnostics.${Date.now()}.tmp`);
    writeFileSync(tempPath, json, 'utf8');
    renameSync(tempPath, targetPath);

    writeCount++;
  }

  function schedule(): void {
    if (pendingTimer) return; // already scheduled
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      performWrite();
    }, debounceMs);
  }

  return {
    sync() {
      schedule();
    },
    flush() {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      performWrite();
    },
    stop() {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    },
    _writeCount: () => writeCount,
  };
}
