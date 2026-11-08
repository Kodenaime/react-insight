/**
 * Context Analyzer — tracks Context Provider value changes and counts
 * fan-out consumer components per context update.
 *
 * ## Detection Strategy
 *
 * Context Providers are tag-10 fibers in the Fiber tree. Their `memoizedProps`
 * contain the `value` prop. Each time a Provider's value reference changes,
 * all consuming components (descendant tag-9 fibers or function components
 * that called useContext) re-render.
 *
 * We track:
 *   - Provider value identity (reference-based, using a WeakMap)
 *   - Consumer component count (descendants flagged as CONTEXT_MUTATION)
 *   - Value-change frequency
 *
 * This data feeds into the health engine's `context_fanout_penalty` metric
 * and the render inspector's CONTEXT_MUTATION classification.
 */

import type { FiberAdapter } from './FiberAdapter';

// ── Types ────────────────────────────────────────────────────

export interface ProviderRecord {
  /** Provider name (from type). */
  name: string;
  /** Set of consumer instance IDs. */
  consumerIds: Set<string>;
  /** Number of times this provider's value has changed. */
  changeCount: number;
  /** Current fan-out (number of consumers). */
  fanOut: number;
}

export interface ContextAnalysis {
  /** All tracked providers. */
  providers: ProviderRecord[];
  /** Total provider count. */
  providerCount: number;
  /** Total distinct consumer instances. */
  totalConsumers: number;
  /** Timestamp of this analysis. */
  timestamp: number;
}

// ── Provider tracking ────────────────────────────────────────

const providerValueMap = new WeakMap<object, unknown>();
const providerRecords = new Map<string, ProviderRecord>();
const _seenContextProviders = new WeakSet<object>();

/** @internal */
export function _resetContextAnalysis(): void {
  providerRecords.clear();
}

// ── Constants ────────────────────────────────────────────────

const PROVIDER_TAG = 10;
const CONSUMER_TAG = 9;

// ── Analysis ─────────────────────────────────────────────────

/**
 * Analyze context providers in the committed fiber tree.
 *
 * Callbacks:
 *   - onProviderChange(name, providerFiber): called when a provider's value
 *     reference has changed since last analysis.
 */
export function analyzeContext(
  fiberRoot: unknown,
  adapter: FiberAdapter,
  onProviderChange?: (name: string, fiber: unknown) => void,
): ContextAnalysis {
  // Walk the tree collecting providers and counting consumers
  const providerIds = new Set<string>();

  walkForContext(fiberRoot, adapter, providerIds, onProviderChange);

  // Build analysis
  const providers: ProviderRecord[] = [];
  let totalConsumers = 0;

  for (const [id, record] of providerRecords) {
    if (providerIds.has(id)) {
      providers.push(record);
      totalConsumers += record.fanOut;
    }
  }

  return {
    providers,
    providerCount: providers.length,
    totalConsumers,
    timestamp: Date.now(),
  };
}

function walkForContext(
  fiber: unknown | null,
  adapter: FiberAdapter,
  providerIds: Set<string>,
  onProviderChange?: (name: string, fiber: unknown) => void,
): void {
  if (!fiber) return;

  const tag = adapter.getTag(fiber);

  // ── Detect Provider (tag 10) ────────────────────────────
  if (tag === PROVIDER_TAG) {
    const fiberObj = fiber as any;
    const props = fiberObj?.memoizedProps;
    const type = adapter.getType(fiber);
    const name = typeof type === 'function'
      ? (type as { displayName?: string }).displayName || type.name || '(Context.Provider)'
      : '(Context.Provider)';

    const providerKey = `${name}__${fiberObj?.key || 'no-key'}`;
    providerIds.add(providerKey);

    if (!providerRecords.has(providerKey)) {
      providerRecords.set(providerKey, {
        name,
        consumerIds: new Set(),
        changeCount: 0,
        fanOut: 0,
      });
    }

    // Check for value change using the fiber object as a WeakMap key
    if (props && typeof props.value !== 'undefined') {
      if (providerValueMap.has(fiberObj)) {
        const prevValue = providerValueMap.get(fiberObj);
        if (prevValue !== props.value) {
          const record = providerRecords.get(providerKey)!;
          record.changeCount++;
          onProviderChange?.(providerKey, fiber);
        }
      }
      providerValueMap.set(fiberObj, props.value);
    }

    // Recurse into children to find consumers
    let child = adapter.getChild(fiber);
    while (child) {
      walkForContext(child, adapter, providerIds, onProviderChange);
      child = adapter.getSibling(child);
    }
    return; // Don't also walk via sibling from the provider
  }

  // ── Count Consumers (tag 9) ─────────────────────────────
  if (tag === CONSUMER_TAG) {
    // Find the nearest provider ancestor
    const consumerId = `${adapter.getType(fiber)}||${adapter.getKey(fiber) || ''}`;

    // Walk up to find which provider this consumer belongs to
    let cursor = adapter.getReturn(fiber);
    while (cursor) {
      const parentTag = adapter.getTag(cursor);
      if (parentTag === PROVIDER_TAG) {
        const parentType = adapter.getType(cursor);
        const parentKey = `${typeof parentType === 'function'
          ? (parentType as { displayName?: string }).displayName || parentType.name || '(Context.Provider)'
          : '(Context.Provider)'}__${(cursor as any)?.key || 'no-key'}`;

        const record = providerRecords.get(parentKey);
        if (record) {
          record.consumerIds.add(consumerId);
          record.fanOut = record.consumerIds.size;
        }
        break;
      }
      cursor = adapter.getReturn(cursor);
    }
  }

  // Recurse
  let child = adapter.getChild(fiber);
  while (child) {
    walkForContext(child, adapter, providerIds, onProviderChange);
    child = adapter.getSibling(child);
  }
}

/**
 * Get the current fan-out count for all providers.
 */
export function getContextFanOut(): number {
  let total = 0;
  for (const [, record] of providerRecords) {
    total += record.fanOut;
  }
  return total;
}

/**
 * Get consumer counts for health engine integration.
 */
export function getContextConsumerCount(): number {
  const seen = new Set<string>();
  for (const [, record] of providerRecords) {
    for (const id of record.consumerIds) {
      seen.add(id);
    }
  }
  return seen.size;
}
