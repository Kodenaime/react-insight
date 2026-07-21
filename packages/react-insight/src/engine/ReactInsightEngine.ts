/**
 * ReactInsightEngine — commit-pipeline orchestrator.
 *
 * Called from the DevTools hook shim's `onCommitFiberRoot` callback on every
 * committed render. Walks the committed Fiber tree, tracks component instances,
 * and feeds data into the diff/analysis engines (Phase 2+).
 *
 * ## Architecture
 *
 * ```
 * onCommitFiberRoot(rendererID, root)
 *   └─ analyzeCommit(fiberRoot, rendererID)
 *        ├─ Walk down the Fiber tree via FiberAdapter
 *        ├─ For each component fiber:
 *        │    ├─ trackInstance() → syntheticInstanceId
 *        │    └─ incrementRenderCount()
 *        └─ (Phase 2+: diff props/state, detect unstable refs, etc.)
 * ```
 */

import { probeAdapter, isComponentFiber, type FiberAdapter } from './FiberAdapter';
import {
  trackInstance,
  trackInstanceCleanup,
  incrementRenderCount,
  _resetHistoryStore,
  getInstanceId,
} from './instanceTracker';

// ─────────────────────────────────────────────────────────────
// Engine interface
// ─────────────────────────────────────────────────────────────

export interface ReactInsightEngineAPI {
  analyzeCommit: (fiberRoot: unknown, rendererID: number) => void;
  handleUnmount: (fiber: unknown) => void;
  /** @internal */
  _reset: () => void;
}

// ─────────────────────────────────────────────────────────────
// Adapter resolution (per-commit)
// ─────────────────────────────────────────────────────────────

/**
 * Resolve the FiberAdapter for a given commit.
 *
 * The adapter is selected per-commit because a single page can theoretically
 * have multiple React roots with different versions (rare, but the spec's
 * version matrix says we should handle it).
 *
 * For now this returns the probeAdapter. Phase 1.3 will add version-specific
 * adapter resolution via feature detection.
 */
function resolveAdapter(_fiberRoot: unknown): FiberAdapter {
  return probeAdapter;
}

// ─────────────────────────────────────────────────────────────
// Tree walker
// ─────────────────────────────────────────────────────────────

/**
 * Walk the committed Fiber tree starting from the given root (the HostRoot
 * fiber, i.e. `fiberRoot.current`).
 *
 * For each component fiber encountered:
 *   1. Compute/retrieve the synthetic instance ID.
 *   2. Initialize history if this is a new mount.
 *   3. Bump the render count.
 *   4. (Phase 2): diff previous vs current props/state.
 */
function walkCommittedFiber(fiber: unknown, adapter: FiberAdapter): void {
  let cursor: unknown | null = fiber;

  while (cursor) {
    const tag = adapter.getTag(cursor);

    if (isComponentFiber(tag)) {
      const instanceId = trackInstance(cursor, adapter);
      incrementRenderCount(instanceId);
    }

    // Recurse into children depth-first
    const child = adapter.getChild(cursor);
    if (child) {
      walkCommittedFiber(child, adapter);
    }

    // Move to sibling
    cursor = adapter.getSibling(cursor);
  }
}

// ─────────────────────────────────────────────────────────────
// Engine singleton
// ─────────────────────────────────────────────────────────────

export const ReactInsightEngine: ReactInsightEngineAPI = {
  /**
   * Analyze a committed render pass.
   *
   * Called from the hook shim's onCommitFiberRoot callback.
   *
   * @param fiberRoot - The `root.current` value from the DevTools hook callback
   *   (the HostRoot fiber of the committed tree).
   * @param rendererID - The React renderer ID from the hook callback.
   */
  analyzeCommit(fiberRoot: unknown, _rendererID: number): void {
    if (!fiberRoot) return;

    const adapter = resolveAdapter(fiberRoot);
    const tag = adapter.getTag(fiberRoot);

    // If the root itself is a component (unlikely but defensive), track it
    if (isComponentFiber(tag)) {
      const instanceId = trackInstance(fiberRoot, adapter);
      incrementRenderCount(instanceId);
    }

    // Walk children
    const child = adapter.getChild(fiberRoot);
    if (child) {
      walkCommittedFiber(child, adapter);
    }
  },

  /**
   * Handle a component unmount notification.
   *
   * Called from the hook shim's onCommitFiberUnmount callback.
   * Cleans up the history buffer deterministically and synchronously.
   */
  handleUnmount(fiber: unknown): void {
    if (!fiber) return;
    const adapter = resolveAdapter(fiber);
    const tag = adapter.getTag(fiber);
    if (isComponentFiber(tag)) {
      const instanceId = getInstanceId(fiber, adapter);
      trackInstanceCleanup(instanceId);
    }
  },

  /** @internal */
  _reset(): void {
    _resetHistoryStore();
  },
};
