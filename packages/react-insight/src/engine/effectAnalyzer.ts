/**
 * Effect Analyzer Engine — tracks `useEffect` execution reasons across commits.
 *
 * ## Architecture
 *
 * On each committed render, the analyzer reads the effect hooks from the
 * Fiber's hook linked list, compares current dependency arrays against the
 * previous snapshot, and classifies each effect's execution reason.
 *
 * ## Classification
 *
 * | Status                      | Meaning                                                   |
 * |-----------------------------|-----------------------------------------------------------|
 * | FIRST_MOUNT                 | Initial mount — effects always run                        |
 * | RE_RAN                      | One or more deps changed                                  |
 * | UNBOUNDED                   | No dependency array — effect runs on every render         |
 * | STRICT_MODE_DOUBLE_INVOC    | mount → cleanup → remount pattern (confirmed by probe)    |
 * | OFFSCREEN_REAPPEARANCE      | Component inside Offscreen boundary returned to visibility |
 *
 * ## Dependency Tracking
 *
 * For each `useEffect` hook we store the previous dependency array and diff it
 * against the current array. Each changed index is classified as either a
 * value change or a reference recreation, with a human-readable cause.
 *
 * ## StrictMode Filtering (per FINDINGS.md)
 *
 * The probe confirmed that StrictMode produces a mount → cleanup → remount
 * pattern at the effect level (3 events per mount). We detect this by
 * tracking the mount count per instance within a short time window. The
 * 3rd event (remount) is flagged as STRICT_MODE_DOUBLE_INVOCATION and
 * excluded from "wasted effect" metrics.
 *
 * ## Offscreen / Activity (React 19)
 *
 * When a component is inside an Offscreen boundary (tag 22), effects that
 * re-run without dependency changes are classified as OFFSCREEN_REAPPEARANCE.
 */

import type { FiberAdapter } from './FiberAdapter';
import { compareValues } from './diffEngine';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type EffectStatus =
  | 'FIRST_MOUNT'
  | 'RE_RAN'
  | 'UNBOUNDED'
  | 'STRICT_MODE_DOUBLE_INVOCATION'
  | 'OFFSCREEN_REAPPEARANCE';

export interface ChangedDep {
  /** Index in the dependency array (0-based). */
  index: number;
  /** Whether the change is a reference recreation or a value change. */
  changeType: 'value' | 'reference';
  /** Previous value at this index. */
  prev: unknown;
  /** Current value at this index. */
  current: unknown;
}

export interface EffectAnalysisResult {
  /** Which useEffect call this is (0-based index among all hooks). */
  effectHookIndex: number;
  /** Classified status. */
  status: EffectStatus;
  /** Whether this effect execution was wasteful. */
  wasted: boolean;
  /** Human-readable explanation for the UI. */
  cause: string;
  /** Specific dependency indices that changed (only for RE_RAN). */
  changedDeps: ChangedDep[];
  /** Current dependency array (for display). */
  deps: unknown[] | null;
  /** Previous dependency array (for display). */
  prevDeps: unknown[] | null;
}

export interface EffectAnalysis {
  /** The instance ID these effects belong to. */
  instanceId: string;
  /** The component's display name. */
  componentName: string;
  /** Results for each effect in the component. */
  effects: EffectAnalysisResult[];
  /** Whether any effect is unbounded (no deps array). */
  hasUnboundedEffect: boolean;
  /** Whether this component is inside an Offscreen boundary. */
  isOffscreenBound: boolean;
}

// ─────────────────────────────────────────────────────────────
// Previous dep store
// ─────────────────────────────────────────────────────────────

interface StoredEffectDeps {
  /** Dependency arrays keyed by effectHookIndex. */
  depsByIndex: Map<number, unknown[] | null>;
  /** Mount count for StrictMode detection. */
  mountSequence: number[];
}

const prevEffectDeps = new Map<string, StoredEffectDeps>();

/** @internal */
export function _resetEffectStore(): void {
  prevEffectDeps.clear();
}

/** @internal */
export function _getEffectStore(id: string): StoredEffectDeps | undefined {
  return prevEffectDeps.get(id);
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const OFFCREEN_TAG = 22;
const STRICT_MODE_WINDOW_MS = 500; // 500ms window for mount → cleanup → remount

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Read effect hooks from a fiber's hook linked list.
 *
 * In React's Fiber architecture, each `useEffect` call creates a hook node
 * in the linked list at `fiber.memoizedState`. The hook's `memoizedState`
 * is the effect object: `{ create, destroy, deps, next, tag }`.
 *
 * We walk the list, collect only hooks that have effect-like queues
 * (a `queue` with `lastRenderedState` that is an effect object with deps).
 *
 * Returns an array of { deps, effectIndex } for each effect found.
 */
function readEffectHooks(
  fiber: unknown,
): Array<{ deps: unknown[] | null; effectIndex: number }> {
  const effects: Array<{ deps: unknown[] | null; effectIndex: number }> = [];
  let hookIndex = 0;
  let current: any = (fiber as any)?.memoizedState;

  while (current) {
    // An effect hook's memoizedState is the effect object { create, destroy, deps, tag }
    const effectObj = current.memoizedState;
    if (effectObj && typeof effectObj === 'object' && 'deps' in effectObj) {
      effects.push({
        deps: effectObj.deps, // null for missing deps, [] for empty, array otherwise
        effectIndex: hookIndex,
      });
    }
    hookIndex++;
    current = current.next;
  }

  return effects;
}

/**
 * Check if a fiber or any ancestor is inside an Offscreen boundary (tag 22).
 */
function hasOffscreenAncestor(fiber: unknown, adapter: FiberAdapter): boolean {
  let cursor: unknown | null = fiber;
  while (cursor) {
    const tag = adapter.getTag(cursor);
    if (tag === OFFCREEN_TAG) return true;
    cursor = adapter.getReturn(cursor);
  }
  return false;
}

/**
 * Read the tag of the Mode wrapper fiber (tag 8).
 * Returns the mode's props if present.
 */
function getModeProps(fiber: unknown, adapter: FiberAdapter): unknown {
  let cursor: unknown | null = adapter.getReturn(fiber);
  while (cursor) {
    const tag = adapter.getTag(cursor);
    if (tag === 8) return adapter.getType(cursor);
    cursor = adapter.getReturn(cursor);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Analysis
// ─────────────────────────────────────────────────────────────

/**
 * Analyze effects for a component fiber on every commit.
 *
 * @param fiber - The committed Fiber node.
 * @param adapter - Version-normalized Fiber adapter.
 * @param instanceId - The synthetic instance ID.
 * @returns Full effect analysis.
 */
export function analyzeEffects(
  fiber: unknown,
  adapter: FiberAdapter,
  instanceId: string,
  componentName?: string,
): EffectAnalysis {
  // Resolve component name
  const typeName = adapter.getType(fiber);
  const resolvedName = componentName
    ?? (typeof typeName === 'function'
      ? (typeName as { displayName?: string }).displayName || typeName.name || '(anonymous)'
      : typeof typeName === 'string' ? typeName : '(unknown)');

  const currentEffects = readEffectHooks(fiber);
  const isOffscreenBound = hasOffscreenAncestor(fiber, adapter);

  // Retrieve or create the stored deps for this instance
  let stored = prevEffectDeps.get(instanceId);
  if (!stored) {
    stored = { depsByIndex: new Map(), mountSequence: [] };
    prevEffectDeps.set(instanceId, stored);
  }

  // Track mount sequence for StrictMode detection
  stored.mountSequence.push(Date.now());
  // Keep only entries within the strict mode window
  stored.mountSequence = stored.mountSequence.filter(
    t => Date.now() - t < STRICT_MODE_WINDOW_MS,
  );

  // Detect StrictMode pattern: 3+ mounts in rapid succession
  const isStrictModeDouble = stored.mountSequence.length >= 3;

  const results: EffectAnalysisResult[] = [];
  let hasUnboundedEffect = false;

  for (const effect of currentEffects) {
    const { deps, effectIndex } = effect;
    const prevDeps = stored.depsByIndex.get(effectIndex) ?? undefined;

    // Store deps for next comparison
    stored.depsByIndex.set(effectIndex, deps);

    // ── UNBOUNDED: no dependency array ─────────────────────
    if (deps === null || deps === undefined) {
      hasUnboundedEffect = true;
      const cause = isStrictModeDouble
        ? 'useEffect has no dependency array and re-runs on every render. StrictMode double-invocation detected (mount → cleanup → remount pattern).'
        : 'useEffect has no dependency array — runs on every render. Fix: add a dependency array to limit execution.';

      results.push({
        effectHookIndex: effectIndex,
        status: 'UNBOUNDED',
        wasted: !isStrictModeDouble,
        cause,
        changedDeps: [],
        deps: null,
        prevDeps: null,
      });
      continue;
    }

    // ── FIRST_MOUNT: no previous deps ──────────────────────
    if (prevDeps === undefined) {
      const cause = isStrictModeDouble
        ? 'Initial mount (may be StrictMode double-invocation — effect runs mount → cleanup → remount).'
        : 'Initial mount — effect runs once after first render.';

      results.push({
        effectHookIndex: effectIndex,
        status: isStrictModeDouble ? 'STRICT_MODE_DOUBLE_INVOCATION' : 'FIRST_MOUNT',
        wasted: false,
        cause,
        changedDeps: [],
        deps,
        prevDeps: null,
      });
      continue;
    }

    // ── OFFSCREEN_REAPPEARANCE ─────────────────────────────
    if (isOffscreenBound && deps.length === prevDeps.length &&
        deps.every((d, i) => d === prevDeps[i])) {
      results.push({
        effectHookIndex: effectIndex,
        status: 'OFFSCREEN_REAPPEARANCE',
        wasted: false,
        cause: 'Component re-entered viewport after being hidden by an Offscreen/Activity boundary. Effect re-ran due to visibility change, not dependency change.',
        changedDeps: [],
        deps,
        prevDeps,
      });
      continue;
    }

    // ── RE_RAN: compare deps ───────────────────────────────
    const changedDeps: ChangedDep[] = [];
    let allSame = true;

    // Empty deps [] means the effect only runs on mount
    if (deps.length === 0) {
      if (!isStrictModeDouble) {
        // Empty deps with no change — effect shouldn't re-run. This is unusual.
        // But with StrictMode we expect the remount.
        results.push({
          effectHookIndex: effectIndex,
          status: isStrictModeDouble ? 'STRICT_MODE_DOUBLE_INVOCATION' : 'FIRST_MOUNT',
          wasted: false,
          cause: isStrictModeDouble
            ? 'StrictMode double-invocation (empty deps []).'
            : 'useEffect with empty dependency array [] — runs only on mount and unmount.',
          changedDeps: [],
          deps,
          prevDeps,
        });
        continue;
      }
    }

    // Compare current vs previous deps
    if (prevDeps === null || prevDeps === undefined) {
      // Deps went from undefined to defined — still a re-run
      allSame = false;
    } else {
      const maxLen = Math.max(deps.length, prevDeps.length);
      for (let i = 0; i < maxLen; i++) {
        const current = i < deps.length ? deps[i] : undefined;
        const prev = i < prevDeps.length ? prevDeps[i] : undefined;

        if (current !== prev) {
          const diff = compareValues(prev, current);
          const changeType = diff.status === 'VALUES_IDENTICAL' ? 'reference' : 'value';
          changedDeps.push({ index: i, changeType, prev, current });
          allSame = false;
        }
      }
    }

    if (allSame) {
      // Deps are identical — this shouldn't happen if effect re-ran normally.
      // Could be Offscreen or StrictMode.
      if (isOffscreenBound) {
        results.push({
          effectHookIndex: effectIndex,
          status: 'OFFSCREEN_REAPPEARANCE',
          wasted: false,
          cause: 'Dependencies unchanged — effect re-ran due to Offscreen boundary visibility change.',
          changedDeps: [],
          deps,
          prevDeps,
        });
        continue;
      }
      if (isStrictModeDouble) {
        results.push({
          effectHookIndex: effectIndex,
          status: 'STRICT_MODE_DOUBLE_INVOCATION',
          wasted: false,
          cause: 'StrictMode double-invocation — effect dependencies unchanged.',
          changedDeps: [],
          deps,
          prevDeps,
        });
        continue;
      }
    }

    // Build human-readable cause
    let cause: string;
    if (changedDeps.length === 0) {
      cause = 'Effect re-ran. Dependency array changed structurally.';
    } else {
      const parts = changedDeps.map(d => {
        const changeWord = d.changeType === 'reference' ? 'reference recreated' : 'value changed';
        const prevStr = typeof d.prev === 'object' ? '[object]' : `"${d.prev}"`;
        const currStr = typeof d.current === 'object' ? '[object]' : `"${d.current}"`;
        return `deps[${d.index}] ${changeWord} (${prevStr} → ${currStr})`;
      });
      cause = `Effect re-ran because: ${parts.join('; ')}.`;
    }

    results.push({
      effectHookIndex: effectIndex,
      status: isStrictModeDouble ? 'STRICT_MODE_DOUBLE_INVOCATION' : 'RE_RAN',
      wasted: isStrictModeDouble ? false : changedDeps.length > 0,
      cause,
      changedDeps,
      deps,
      prevDeps,
    });
  }

  return {
    instanceId,
    componentName: resolvedName,
    effects: results,
    hasUnboundedEffect,
    isOffscreenBound,
  };
}
