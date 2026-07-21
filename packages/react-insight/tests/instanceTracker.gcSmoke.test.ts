/**
 * GC smoke test — FinalizationRegistry backstop verification.
 *
 * ⚠️ FLAKY BY NATURE — DO NOT ADD TO REQUIRED CI GATES ⚠️
 *
 * FinalizationRegistry callback timing is NOT guaranteed by the ECMAScript
 * specification. Even after a forced `gc()` call, the registry's cleanup
 * callback may run late, run partially, or not run at all within a given
 * test window. This depends on:
 *   - The JS engine's GC scheduling (V8, SpiderMonkey, etc.)
 *   - Memory pressure
 *   - Whether the runtime is running in a debugger/inspector
 *   - Phase of the moon
 *
 * This test mounts 1,000 components WITHOUT calling the explicit cleanup
 * path, relying solely on FinalizationRegistry. It then forces GC and
 * polls for up to 5 seconds, logging whether cleanup completed.
 *
 * The test does NOT fail if cleanup doesn't complete — it reports the
 * result for informational purposes. The explicit cleanup path in
 * trackInstanceCleanup() is the actual correctness gate (see
 * instanceTracker.deterministic.test.ts).
 *
 * ## Running
 *
 *   node --expose-gc node_modules/.bin/vitest run --reporter=verbose \\
 *     tests/instanceTracker.gcSmoke.test.ts
 *
 * Or:
 *
 *   pnpm test:gc-smoke
 */

import { describe, it, expect } from 'vitest';
import {
  trackInstance,
  _resetHistoryStore,
  _historyStoreSize,
} from '../src/engine/instanceTracker';
import { probeAdapter } from '../src/engine/FiberAdapter';

// ── Guard: skip if gc() isn't available ─────────────────────────────────

const hasGC = typeof globalThis.gc === 'function';

function mockFiber(overrides: Record<string, unknown> = {}): unknown {
  return {
    tag: 0,
    type: 'GCTest',
    key: null,
    return: null,
    child: null,
    sibling: null,
    stateNode: null,
    _debugSource: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('instanceTracker — GC smoke test (informational only)', () => {
  it('should be skipped if gc() is not available', () => {
    if (!hasGC) {
      console.warn(
        '  ⚠️  GC smoke test skipped: --expose-gc flag not set.\n' +
        '     Run with: node --expose-gc node_modules/.bin/vitest run\n' +
        '     Or: pnpm test:gc-smoke',
      );
    }
    // Pass regardless — this test is informational
    expect(true).toBe(true);
  });

  it('FinalizationRegistry cleans up history when instances are GCed (informational)', async () => {
    if (!hasGC) {
      console.log('  ↪ Skipping — gc() not available');
      return;
    }

    _resetHistoryStore();

    // Mount 1,000 instances WITHOUT calling explicit cleanup, keeping
    // references that we'll drop to trigger GC.
    const tokens: { release(): void }[] = [];

    for (let i = 0; i < 1000; i++) {
      const fiber = mockFiber({ type: 'GCTest', key: `gc-item-${i}` });
      trackInstance(fiber, probeAdapter);

      // Create a token whose sole purpose is to keep the fiber reachable
      // until we explicitly release it.
      let keepAlive: unknown = fiber;
      tokens.push({
        release() {
          keepAlive = null;
        },
      });
    }

    const initialSize = _historyStoreSize();
    console.log(`  Mounted ${initialSize} instances via FinalizationRegistry only`);

    // Drop all references that keep the registration targets alive
    for (const t of tokens) {
      t.release();
    }

    // Force GC up to 3 times with backoff
    let remaining = _historyStoreSize();
    const pollLimit = 50; // ~5 seconds at 100ms intervals
    let polls = 0;

    for (let attempt = 0; attempt < 3; attempt++) {
      globalThis.gc!();

      for (polls = 0; polls < pollLimit; polls++) {
        remaining = _historyStoreSize();
        if (remaining === 0) break;
        await new Promise(r => setTimeout(r, 100));
      }

      if (remaining === 0) break;
    }

    if (remaining === 0) {
      console.log(`  ✅ FinalizationRegistry cleaned all ${initialSize} entries (${polls + 1} polls)`);
    } else {
      console.log(
        `  ⚠️  FinalizationRegistry cleaned ${initialSize - remaining}/${initialSize} entries ` +
        `within timeout (${remaining} remaining). ` +
        `This is EXPECTED — GC timing is not guaranteed.`,
      );
    }

    // Cleanup any stragglers to avoid cross-test pollution
    _resetHistoryStore();

    // This assertion never fails — it's purely informational.
    // The actual CI gate is instanceTracker.deterministic.test.ts.
    expect(true).toBe(true);
  });
});
