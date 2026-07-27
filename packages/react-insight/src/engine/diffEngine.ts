/**
 * Smart Conditional Diffing Engine — two-tier comparison with cycle safety
 * and bounded-claim messaging.
 *
 * ## Strategy
 *
 * 1. **Fast Path (Shallow Reference Check):** O(1) `prev === next`.
 *    When equal, the values are the same object reference — no diff needed.
 *
 * 2. **Targeted Deep Path (On Reference Failure):** Only when `prev !== next`.
 *    Walk both values structurally, key by key, up to configurable limits.
 *    Deep equality within bounds → "values are identical" recommendation.
 *    Structural difference → report exactly which paths changed and how.
 *
 * ## Bounded Limits (matching the spec §2.2)
 *
 * - maxDepth: 4
 * - maxKeysPerLevel: 50
 * - Cycle guard: WeakSet of visited object references
 *
 * ## Bounded-Claim Messaging
 *
 * If the full depth was checked and values match, the message asserts equality.
 * If limits were hit before reaching the leaves, a truncation qualifier is
 * appended — never present a partial check as a complete one.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type DiffStatus = 'IDENTICAL' | 'VALUES_IDENTICAL' | 'CHANGED';

export interface ChangedPath {
  /** Dot/bracket-notation path from root, e.g. "items[3].name" */
  path: string;
  /** Whether the difference is a reference change (new object) or a value change */
  changeType: 'reference' | 'value';
  /** Previous value (serialized to string if object) */
  prev: unknown;
  /** Next value (serialized to string if object) */
  next: unknown;
}

export interface DiffResult {
  /** Overall status of the comparison */
  status: DiffStatus;
  /** Human-readable explanation for UI display */
  reason: string | null;
  /** Specific paths that changed (only populated when status = 'CHANGED') */
  changedPaths: ChangedPath[];
  /**
   * Whether comparison was truncated due to depth/key limits.
   * When true, the comparison may be incomplete and the reason string
   * includes the truncation qualifier.
   */
  truncated: boolean;
  /** Depth of the deepest comparison performed */
  depthReached: number;
}

// ─────────────────────────────────────────────────────────────
// Default limits
// ─────────────────────────────────────────────────────────────

export const DEFAULT_MAX_DEPTH = 4;
export const DEFAULT_MAX_KEYS_PER_LEVEL = 50;

// ─────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────

export interface DiffOptions {
  /** Maximum nesting depth to traverse. Default: 4 */
  maxDepth?: number;
  /** Maximum keys to scan per object level. Default: 50 */
  maxKeysPerLevel?: number;
}

/**
 * Compare two values structurally, with bounded depth and cycle safety.
 *
 * Fast path (same reference) returns immediately. Deep path walks
 * structure key by key up to configured limits.
 *
 * The returned DiffResult is used by the Render Reason Inspector to
 * explain whether a prop/state change was a meaningful value change
 * or an unnecessary reference recreation.
 */
export function compareValues(
  prev: unknown,
  next: unknown,
  options: DiffOptions = {},
): DiffResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxKeys = options.maxKeysPerLevel ?? DEFAULT_MAX_KEYS_PER_LEVEL;

  // ── Fast Path ──────────────────────────────────────────────
  if (prev === next) {
    return {
      status: 'IDENTICAL',
      reason: null,
      changedPaths: [],
      truncated: false,
      depthReached: 0,
    };
  }

  // ── Deep Path ──────────────────────────────────────────────
  const changedPaths: ChangedPath[] = [];
  const visited = new WeakSet<object>();
  let depthReached = 0;
  let truncated = false;

  const result = deepCompare(prev, next, '', 0);

  if (result === true) {
    // Structural values match within limits
    const reason = `Values are identical within the first ${maxDepth} levels checked. Fix: move outside render loop or wrap in useMemo.`;
    return {
      status: 'VALUES_IDENTICAL',
      reason: truncated ? reason + ' (comparison truncated at configured limits)' : reason,
      changedPaths: [],
      truncated,
      depthReached,
    };
  }

  // Structural difference found
  const reason = changedPaths.length > 0
    ? formatChangeSummary(changedPaths, truncated)
    : 'Values are different structures.';
  return {
    status: 'CHANGED',
    reason: truncated ? reason + ' (comparison truncated at configured limits)' : reason,
    changedPaths,
    truncated,
    depthReached,
  };

  // ── Internal recursive walker ──────────────────────────────

  function deepCompare(
    a: unknown,
    b: unknown,
    path: string,
    depth: number,
  ): boolean {
    if (depth > depthReached) depthReached = depth;

    // Fast path at every level
    if (a === b) return true;

    // If either is null/undefined
    if (a == null || b == null) {
      recordChange(path, a, b);
      return false;
    }

    // Type mismatch
    if (typeof a !== typeof b) {
      recordChange(path, a, b);
      return false;
    }

    // Primitives: direct comparison
    if (typeof a !== 'object') {
      if (a !== b) {
        recordChange(path, a, b);
        return false;
      }
      return true;
    }

    // ── Both are objects at this point ───────────────────────

    // Cycle guard
    if (visited.has(a as object)) {
      // If we've already seen `a`, treat structures as equivalent
      // at this point (we've already compared this path elsewhere)
      return true;
    }
    visited.add(a as object);

    // Depth limit
    if (depth >= maxDepth) {
      truncated = true;
      // Can't go deeper — assume equivalent since we can't prove
      // a difference at this level and the reference differs.
      // The caller will see the truncated flag.
      visited.delete(a as object);
      return true;
    }

    // Array comparison
    if (Array.isArray(a) && Array.isArray(b)) {
      const result = compareArrays(a, b, path, depth);
      visited.delete(a as object);
      return result;
    }

    // Plain object comparison
    if (Array.isArray(a) !== Array.isArray(b)) {
      recordChange(path, a, b);
      visited.delete(a as object);
      return false;
    }

    const result = compareObjects(a as Record<string, unknown>, b as Record<string, unknown>, path, depth, maxKeys);
    visited.delete(a as object);
    return result;
  }

  function compareArrays(
    a: unknown[],
    b: unknown[],
    path: string,
    depth: number,
  ): boolean {
    // Key limit applies to array length comparison
    const maxLen = Math.max(a.length, b.length);
    const keysToCheck = Math.min(maxLen, maxKeys);
    if (maxLen > maxKeys) truncated = true;

    let allMatch = true;
    for (let i = 0; i < keysToCheck; i++) {
      const keyA = i < a.length ? a[i] : undefined;
      const keyB = i < b.length ? b[i] : undefined;
      const itemPath = `${path}[${i}]`;
      if (!deepCompare(keyA, keyB, itemPath, depth + 1)) {
        allMatch = false;
      }
    }
    return allMatch;
  }

  function compareObjects(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    path: string,
    depth: number,
    maxKeys: number,
  ): boolean {
    const allKeys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
    const keysToCheck = allKeys.slice(0, maxKeys);

    if (allKeys.length > maxKeys) truncated = true;

    let allMatch = true;
    for (const key of keysToCheck) {
      const childPath = path ? `${path}.${key}` : key;
      const hasA = key in a;
      const hasB = key in b;

      if (!hasA || !hasB) {
        recordChange(childPath, hasA ? a[key] : undefined, hasB ? b[key] : undefined);
        allMatch = false;
        continue;
      }

      if (!deepCompare(a[key], b[key], childPath, depth + 1)) {
        allMatch = false;
      }
    }
    return allMatch;
  }

  function recordChange(path: string, prevVal: unknown, nextVal: unknown): void {
    const changeType = (typeof prevVal === 'object' && prevVal !== null) ||
      (typeof nextVal === 'object' && nextVal !== null)
      ? 'reference' as const
      : 'value' as const;

    changedPaths.push({
      path,
      changeType,
      prev: serializeForDisplay(prevVal),
      next: serializeForDisplay(nextVal),
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function serializeForDisplay(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 200 ? value.slice(0, 200) + '...' : value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'function') return `[function ${value.name || '(anonymous)'}]`;
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  if (typeof value === 'object') return `[object ${value.constructor?.name || 'Object'}]`;
  return String(value);
}

function formatChangeSummary(changes: ChangedPath[], truncated: boolean): string {
  if (changes.length === 0) return 'Values are different structures.';

  const lines = ['Values differ:'];
  for (const c of changes.slice(0, 5)) {
    lines.push(`  ${c.path}: ${JSON.stringify(c.prev)} → ${JSON.stringify(c.next)} (${c.changeType})`);
  }
  if (changes.length > 5) {
    lines.push(`  ... and ${changes.length - 5} more changes`);
  }

  return lines.join('\n');
}
