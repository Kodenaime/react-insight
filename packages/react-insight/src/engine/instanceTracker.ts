/**
 * Instance Tracker — stable synthetic instance identity + memory cleanup.
 *
 * ## Why not Fiber references?
 *
 * React double-buffers Fiber nodes between "current" and "work-in-progress"
 * trees across renders. The Fiber object reference for a given component
 * *instance* is not stable over that instance's lifetime. Keying history
 * off a WeakMap<Fiber, ...> silently misattributes or loses history.
 *
 * ## Stable identity via synthetic instance IDs
 *
 * Each mounted component receives a synthetic ID derived from:
 *   tree position (sibling-index path) + component type name + `key` prop
 *
 * This ID is stable across renders of the same instance, even though the
 * Fiber object reference changes.
 *
 * ## Cleanup strategy (two-tier)
 *
 * 1. **Explicit (primary):** `trackInstanceCleanup()` is called synchronously
 *    when the commit pipeline detects an unmount via `onCommitFiberUnmount`.
 *    This is the primary cleanup mechanism — it is deterministic and immediate.
 *
 * 2. **FinalizationRegistry (backstop):** A FinalizationRegistry token is
 *    registered against the instance's host object (stateNode for class/host
 *    components, or a synthetic wrapper for function components). If the
 *    explicit path misses an unmount (e.g. abrupt teardown, error edge case),
 *    the registry cleans up on the next GC cycle.
 *
 *    ⚠️ FinalizationRegistry callback timing is NOT guaranteed by the spec.
 *    Even after `gc()`, callbacks may run late or not at all. The explicit
 *    cleanup path is the correctness gate. The registry is a defense-in-depth
 *    measure only.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

import type { FiberAdapter } from './FiberAdapter';
import type { RenderReason } from './renderInspector';
import type { EffectAnalysis, EffectAnalysisResult } from './effectAnalyzer';

/**
 * Historical data stored per-component for diffing and analysis.
 * This is a stub — the actual history buffer shape will expand in Phase 2.
 */
export interface ComponentHistory {
  /** The synthetic instance ID derived at mount time. */
  instanceId: string;
  /** Monotonic render count for this instance (since mount). */
  renderCount: number;
  /** Cumulative count of wasted (unnecessary) renders since mount. */
  wastedRenderCount: number;
  /** Metadata about the component. */
  componentName: string;
  /** Last known props snapshot (placeholder for the diff engine). */
  lastProps?: unknown;
  /** Last known state snapshot (placeholder for the diff engine). */
  lastState?: unknown;
  /** Reason for the most recent render. */
  lastRenderReason?: RenderReason;
  /** Whether the most recent render was wasted. */
  lastRenderWasted?: boolean;
  /** Latest effect analysis results. */
  lastEffectAnalysis?: EffectAnalysis;
}

/**
 * Configuration passed to trackInstance for computing the synthetic ID.
 */
export interface TrackOptions {
  /** The committed Fiber node. */
  fiber: unknown;
  /** Version-normalized Fiber adapter. */
  adapter: FiberAdapter;
  /** Optional overrides for the instance ID components. */
  overrides?: {
    typeName?: string;
    key?: string | null;
  };
}

// ─────────────────────────────────────────────────────────────
// History store (module-level singleton)
// ─────────────────────────────────────────────────────────────

/**
 * In-memory store of per-component history buffers.
 * Keyed by syntheticInstanceId.
 */
const historyStore = new Map<string, ComponentHistory>();

/**
 * Exposed for testing — reset the store to clean state.
 * @internal
 */
export function _resetHistoryStore(): void {
  historyStore.clear();
}

/**
 * Exposed for testing — get the current store size.
 * @internal
 */
export function _historyStoreSize(): number {
  return historyStore.size;
}

/**
 * Exposed for testing — read a specific entry.
 * @internal
 */
export function _getHistory(instanceId: string): ComponentHistory | undefined {
  return historyStore.get(instanceId);
}

/**
 * Drop a history entry by instance ID.
 * Called both from the explicit cleanup path and from FinalizationRegistry.
 */
function deleteHistory(instanceId: string): void {
  historyStore.delete(instanceId);
}

// ─────────────────────────────────────────────────────────────
// FinalizationRegistry backstop
// ─────────────────────────────────────────────────────────────

/**
 * FinalizationRegistry that cleans up history buffers when a component's
 * host object is garbage collected.
 *
 * This is a BACKSTOP only. The primary cleanup path is the explicit
 * `trackInstanceCleanup()` call from `onCommitFiberUnmount`.
 *
 * We use a plain object as the registration target (the "value" in
 * registry.register(target, value)). For class and host components this
 * could be `fiber.stateNode`, but for function components stateNode is
 * null. We always use a synthetic token object.
 */
const finalizationRegistry = new FinalizationRegistry<string>((instanceId: string) => {
  deleteHistory(instanceId);
});

// ─────────────────────────────────────────────────────────────
// Instance ID computation
// ─────────────────────────────────────────────────────────────

/**
 * Build the tree-position path from root to the given fiber.
 * Each element is the sibling index at that level.
 *
 * Examples:
 *   - Root → [0]
 *   - First child of root → [0, 0]
 *   - Second child of root → [0, 1]
 *   - First child of second child of root → [0, 1, 0]
 */
function buildTreePath(fiber: unknown, adapter: FiberAdapter): number[] {
  const path: number[] = [];

  // Walk fiber → parent and count siblings at each level.
  // The path is built root → leaf, so we collect then reverse.
  let cursor: unknown | null = fiber;
  while (cursor) {
    const parent: unknown | null = adapter.getReturn(cursor);
    if (!parent) break; // reached HostRoot (tag 3, return = null)

    // Count how many previous siblings this fiber has at its level.
    let siblingIndex = 0;
    let sibling = adapter.getChild(parent);
    while (sibling && sibling !== cursor) {
      siblingIndex++;
      sibling = adapter.getSibling(sibling);
    }
    // If cursor wasn't found as a child of parent (shouldn't happen), use 0
    path.push(siblingIndex);
    cursor = parent; // keep climbing to root
  }

  path.reverse(); // root → leaf
  return path;
}

/**
 * Get a human-readable type name from a fiber's type field.
 */
function getTypeName(fiber: unknown, adapter: FiberAdapter): string {
  const type = adapter.getType(fiber);
  if (type === null || type === undefined) return 'HostRoot';
  if (typeof type === 'string') return type; // host element like "div"
  if (typeof type === 'function') return (type as { displayName?: string }).displayName || type.name || '(anonymous)';
  if (typeof type === 'object') {
    // Check for React-specific symbols
    const $$typeof = (type as any).$$typeof;
    if ($$typeof) {
      const sym = String($$typeof);
      if (sym.includes('react.provider')) return '(Context.Provider)';
      if (sym.includes('react.context')) return '(Context)';
      if (sym.includes('react.forward_ref')) return '(ForwardRef)';
      if (sym.includes('react.memo')) return '(Memo)';
      if (sym.includes('react.lazy')) return '(Lazy)';
      if (sym.includes('react.strict_mode')) return '(StrictMode)';
      return sym;
    }
    return '(anonymous)';
  }
  return String(type);
}

/**
 * Compute a stable synthetic instance ID for a fiber.
 *
 * Format: `typeName|key|path`
 *
 * Examples:
 *   - App|App|0.0
 *   - ExpenseTable||0.0.2
 *   - div||0.0.0      (host elements are less relevant but get IDs too)
 *   - ExpenseRow|row-42|0.0.2.1
 */
export function getInstanceId(fiber: unknown, adapter: FiberAdapter): string {
  const typeName = getTypeName(fiber, adapter);
  const key = adapter.getKey(fiber);
  const path = buildTreePath(fiber, adapter);

  const keyPart = key != null ? key : '';
  return `${typeName}|${keyPart}|${path.join('.')}`;
}

// ─────────────────────────────────────────────────────────────
// Tracking
// ─────────────────────────────────────────────────────────────

/**
 * Track a newly mounted component instance.
 *
 * Assigns a synthetic instance ID, initializes a history buffer, and
 * registers a FinalizationRegistry token so the buffer is cleaned up
 * if the instance vanishes without an explicit cleanup call.
 *
 * @returns The assigned syntheticInstanceId.
 */
export function trackInstance(fiber: unknown, adapter: FiberAdapter): string {
  const instanceId = getInstanceId(fiber, adapter);
  const typeName = getTypeName(fiber, adapter);

  // Only create a new entry if one doesn't already exist (mount, not update)
  if (!historyStore.has(instanceId)) {
    historyStore.set(instanceId, {
      instanceId,
      renderCount: 0,
      wastedRenderCount: 0,
      componentName: typeName,
    });
  }

  // Register a FinalizationRegistry token against a synthetic object.
  // Class components have fiber.stateNode, function components don't —
  // we use a plain object as the target for both cases.
  const token = { instanceId };
  finalizationRegistry.register(token, instanceId);

  return instanceId;
}

/**
 * Explicit cleanup path — called when a component unmounts.
 *
 * This is the PRIMARY cleanup mechanism. It removes the history buffer
 * immediately and deterministically, unlike FinalizationRegistry which
 * has unspecified timing.
 *
 * Safe to call multiple times for the same instance (subsequent calls
 * are no-ops).
 */
export function trackInstanceCleanup(instanceId: string): void {
  deleteHistory(instanceId);
}

/**
 * Bump the render count for a tracked instance.
 * Called during each committed render pass.
 */
export function incrementRenderCount(instanceId: string): void {
  const entry = historyStore.get(instanceId);
  if (entry) {
    entry.renderCount++;
  }
}

/**
 * Get all tracked component histories (for the UI overlay / export).
 */
export function getAllHistories(): ComponentHistory[] {
  return Array.from(historyStore.values());
}
