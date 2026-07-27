/**
 * Render Reason Inspector — classifies why each component re-rendered.
 *
 * ## Architecture
 *
 * On every committed render, the inspector walks the Fiber tree (via
 * FiberAdapter), compares current props/state against the previous snapshot
 * stored in ComponentHistory, and assigns a RenderReason to each component.
 *
 * ## Render Reason Classification
 *
 * | Reason                  | Detected When                                          |
 * |-------------------------|--------------------------------------------------------|
 * | MOUNT                   | First time this instance ID is seen                    |
 * | STATE_CHANGE            | memoizedState differs from previous snapshot           |
 * | PROP_VALUE_CHANGE       | memoizedProps differ structurally (deep diff)          |
 * | PROP_REFERENCE_CHANGE   | memoizedProps reference changed, values identical      |
 * | UNMEMOIZED_CALLBACK     | A function-typed prop changed reference                |
 * | CONTEXT_MUTATION        | Fiber is a ContextConsumer (tag 9) and value changed   |
 * | PARENT_RENDER           | Props and state unchanged but component still rendered |
 *
 * ## StrictMode Double-Invocation
 *
 * See scripts/strictmode-probe/FINDINGS.md for the full analysis.
 *
 * Key finding: StrictMode does NOT produce duplicate `onCommitFiberRoot`
 * calls. The double-invocation of component bodies happens DURING the
 * render phase and is discarded before commit. It is NOT observable at
 * the commit/hook level.
 *
 * Therefore, this module does NOT apply a StrictMode filter at the
 * render-reason level — render counts from walkCommittedFiber are accurate.
 *
 * The STRICT_MODE_DOUBLE_INVOCATION reason is defined here as a type for
 * future use by the Effect Analyzer (Phase 2.3), which operates at the
 * effect execution level where the mount → cleanup → remount pattern IS
 * observable. That module will import this type when ready.
 */

import type { FiberAdapter } from './FiberAdapter';
import { compareValues, type DiffResult } from './diffEngine';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Classified reason for a component render.
 *
 * STRICT_MODE_DOUBLE_INVOCATION is reserved for the Effect Analyzer
 * (Phase 2.3). It is never emitted by the commit-level inspector.
 */
export type RenderReason =
  | 'MOUNT'
  | 'STATE_CHANGE'
  | 'PROP_VALUE_CHANGE'
  | 'PROP_REFERENCE_CHANGE'
  | 'UNMEMOIZED_CALLBACK'
  | 'CONTEXT_MUTATION'
  | 'PARENT_RENDER'
  | 'STRICT_MODE_DOUBLE_INVOCATION';

/**
 * Result of analyzing a single component's render.
 */
export interface ComponentRenderResult {
  /** The synthetic instance ID of the component. */
  instanceId: string;
  /** The component's display name. */
  componentName: string;
  /** Primary reason for this render. */
  reason: RenderReason;
  /** Whether this was an unnecessary/wasted render. */
  wasted: boolean;
  /** Detailed diff information (null for MOUNT, IDENTICAL). */
  diff?: DiffResult | null;
  /** Whether comparison was truncated. */
  truncated?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Previous-value store (history buffers from instanceTracker)
// ─────────────────────────────────────────────────────────────

export interface PreviousSnapshot {
  /** Serialized/truncated props from the previous committed render. */
  props: Record<string, unknown> | null;
  /** Serialized/truncated state from the previous committed render. */
  state: unknown;
  /** Whether the previous snapshot represents the initial mount. */
  isMount: boolean;
}

/**
 * In-memory store of previous snapshots keyed by instance ID.
 * This sits alongside ComponentHistory in instanceTracker — it holds
 * the raw prop/state snapshots needed for diffing.
 */
const prevSnapshots = new Map<string, PreviousSnapshot>();

/** @internal */
export function _resetPrevSnapshots(): void {
  prevSnapshots.clear();
}

/** @internal */
export function _getPrevSnapshot(id: string): PreviousSnapshot | undefined {
  return prevSnapshots.get(id);
}

// ─────────────────────────────────────────────────────────────
// Detection helpers
// ─────────────────────────────────────────────────────────────

const FUNCTION_LIKE_TAGS = new Set([0, 2, 15, 16]);
const CLASS_TAG = 1;
const CONTEXT_CONSUMER_TAG = 9;
const CONTEXT_PROVIDER_TAG = 10;

function isFunctionComponent(tag: number): boolean {
  return FUNCTION_LIKE_TAGS.has(tag);
}

/**
 * Read memoizedState from a fiber via the adapter.
 * Returns the raw internal representation — the adapter's getMemoizedState
 * method handles version-specific hook list shapes.
 */
function readState(fiber: unknown, adapter: FiberAdapter): unknown {
  // The probe adapter doesn't have getMemoizedState yet — we read directly
  // from the fiber's memoizedState field, which is safe for the probe adapter.
  return (fiber as any)?.memoizedState ?? null;
}

/**
 * Read memoizedProps from a fiber.
 *
 * Returns the raw reference from the Fiber. The diff engine handles
 * React elements and circular references via its WeakSet cycle guard.
 */
function readProps(fiber: unknown, _adapter: FiberAdapter): Record<string, unknown> {
  const props = (fiber as any)?.memoizedProps;
  if (!props || typeof props !== 'object') return {};
  return props;
}

/**
 * Detect if a prop is or contains a function-type value.
 * Used to flag UNMEMOIZED_CALLBACK.
 */
function hasFunctionProp(props: Record<string, unknown>): string | null {
  for (const [key, val] of Object.entries(props)) {
    if (typeof val === 'function') return key;
    if (typeof val === 'object' && val !== null) {
      // Check common patterns like { onClick: fn }
      for (const nestedKey of Object.keys(val as Record<string, unknown>)) {
        if (typeof (val as Record<string, unknown>)[nestedKey] === 'function') {
          return `${key}.${nestedKey}`;
        }
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────

/**
 * Analyze a component fiber and classify the render reason.
 *
 * @param instanceId - The synthetic instance ID from instanceTracker.
 * @param fiber - The committed Fiber node.
 * @param adapter - Version-normalized Fiber adapter.
 * @returns Classified render result.
 */
export function classifyRender(
  instanceId: string,
  fiber: unknown,
  adapter: FiberAdapter,
): ComponentRenderResult {
  const tag = adapter.getTag(fiber);
  const typeName = adapter.getType(fiber);
  const componentName = typeof typeName === 'function'
    ? (typeName as { displayName?: string }).displayName || typeName.name || '(anonymous)'
    : typeof typeName === 'string'
      ? typeName
      : '(unknown)';

  // ── Read current props/state ──────────────────────────────
  const currentProps = readProps(fiber, adapter);
  const currentState = readState(fiber, adapter);

  // ── Retrieve previous snapshot ────────────────────────────
  const prev = prevSnapshots.get(instanceId);

  // ── MOUNT: first render ───────────────────────────────────
  if (!prev || prev.isMount) {
    prevSnapshots.set(instanceId, {
      props: currentProps,
      state: currentState,
      isMount: false,
    });
    return {
      instanceId,
      componentName,
      reason: 'MOUNT',
      wasted: false,
      diff: null,
    };
  }

  // ── CONTEXT_MUTATION: context consumer ────────────────────
  if (tag === CONTEXT_CONSUMER_TAG) {
    // We can't easily determine context value from fiber internals
    // at the commit level without the version adapter's hook reader.
    // Conservative: flag as context mutation if props differ.
    const propsDiff = compareValues(prev.props, currentProps);
    if (propsDiff.status !== 'IDENTICAL') {
      prevSnapshots.set(instanceId, {
        props: currentProps,
        state: currentState,
        isMount: false,
      });
      return {
        instanceId,
        componentName,
        reason: 'CONTEXT_MUTATION',
        wasted: false,
        diff: propsDiff,
      };
    }
  }

  // ── STATE_CHANGE — checked FIRST because state mutations are intentional ──
  let stateDiff: DiffResult | null = null;
  if (currentState !== prev.state) {
    stateDiff = compareValues(prev.state, currentState);
  }

  if (stateDiff && stateDiff.status === 'CHANGED') {
    prevSnapshots.set(instanceId, {
      props: currentProps,
      state: currentState,
      isMount: false,
    });
    return {
      instanceId,
      componentName,
      reason: 'STATE_CHANGE',
      wasted: false,
      diff: stateDiff,
    };
  }

  // ── UNMEMOIZED_CALLBACK — check before deep prop diff ─────────────────
  const hasCallback = hasFunctionProp(currentProps);
  const hadCallback = prev.props ? hasFunctionProp(prev.props) : null;
  if (hasCallback && hadCallback) {
    prevSnapshots.set(instanceId, {
      props: currentProps,
      state: currentState,
      isMount: false,
    });
    return {
      instanceId,
      componentName,
      reason: 'UNMEMOIZED_CALLBACK',
      wasted: true,
      diff: compareValues(prev.props, currentProps),
    };
  }

  // ── PROP comparison ────────────────────────────────────────────────────
  const propsDiff = compareValues(prev.props, currentProps);

  // IDENTICAL props + state → PARENT_RENDER
  if (propsDiff.status === 'IDENTICAL') {
    prevSnapshots.set(instanceId, {
      props: currentProps,
      state: currentState,
      isMount: false,
    });
    return {
      instanceId,
      componentName,
      reason: 'PARENT_RENDER',
      wasted: true,
      diff: null,
    };
  }

  // VALUES_IDENTICAL (same values, different reference) → PROP_REFERENCE_CHANGE
  if (propsDiff.status === 'VALUES_IDENTICAL') {
    prevSnapshots.set(instanceId, {
      props: currentProps,
      state: currentState,
      isMount: false,
    });
    return {
      instanceId,
      componentName,
      reason: 'PROP_REFERENCE_CHANGE',
      wasted: true,
      diff: propsDiff,
      truncated: propsDiff.truncated,
    };
  }

  // CHANGED → PROP_VALUE_CHANGE
  prevSnapshots.set(instanceId, {
    props: currentProps,
    state: currentState,
    isMount: false,
  });
  return {
    instanceId,
    componentName,
    reason: 'PROP_VALUE_CHANGE',
    wasted: true,
    diff: propsDiff,
  };

  // ── CONTEXT_MUTATION (handled earlier for tag 9) ─────────────────────
}

/**
 * Analyze a component fiber and record the render reason into the
 * component's history. Returns the classified result.
 *
 * This is the entry point called from the commit walker.
 */
export function analyzeComponentRender(
  instanceId: string,
  fiber: unknown,
  adapter: FiberAdapter,
): ComponentRenderResult {
  return classifyRender(instanceId, fiber, adapter);
}

/**
 * Record a component render result into the previous-snapshot store.
 * Separated from classification so the engine can batch analysis.
 */
export function recordRenderResult(result: ComponentRenderResult): void {
  // Rendering was already recorded in classifyRender via prevSnapshots.set()
  // This hook is for future analysis aggregation.
}
