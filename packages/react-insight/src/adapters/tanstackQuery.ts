/**
 * TanStack Query Adapter — instruments query cache events.
 *
 * ## Strategy
 *
 * Auto-attach hooks into QueryClient instances by patching the prototype's
 * `getQueryCache()` method at module load time. When a consumer creates a new
 * `new QueryClient()`, the patched method returns a cache whose `.subscribe()`
 * method is wrapped to emit warnings for:
 *
 *   - Redundant active queries (same query key observed by >1 subscriber)
 *   - Excessive refetches within a short time window
 *
 * If `@tanstack/query-core` is not installed, the adapter silently no-ops.
 *
 * ## Manual attachment
 *
 * If auto-detection fails (e.g. QueryClient is imported via ESM), consumers
 * can call `attachToQueryClient(client)` directly.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { StateAdapter, AdapterWarning } from './types';

const warnings: AdapterWarning[] = [];

/** @internal */
export function _clearWarnings(): void {
  warnings.length = 0;
}

/** @internal */
export function _getWarnings(): AdapterWarning[] {
  return [...warnings];
}

const observedKeys = new Map<string, number>();
let refetchTimestamps: number[] = [];
const REFETCH_WINDOW_MS = 5000;
const REFETCH_THRESHOLD = 5;

// ── Shared instrumentation logic ─────────────────────────────

function instrumentCache(cache: { subscribe: (fn: (event: any) => void) => () => void }): void {
  if (!cache || typeof cache.subscribe !== 'function') return;

  const originalSubscribe = cache.subscribe.bind(cache);

  cache.subscribe = ((event: any) => {
    if (!event || !event.query) return;

    const queryKey = JSON.stringify(event.query.queryKey || event.query.queryHash);
    const action = event.type || event.action?.type || 'unknown';

    if (action === 'added' || action === 'observerAdded' || action === 'queryAdded') {
      const count = observedKeys.get(queryKey) || 0;
      observedKeys.set(queryKey, count + 1);

      if (count >= 1) {
        warnings.push({
          adapterName: 'TanStackQuery',
          type: 'REDUNDANT_QUERY',
          message: `Query key ${queryKey} is observed by ${count + 1} subscribers — redundant data fetching.`,
          recommendation: 'Lift the query to a shared parent or use queryClient.prefetchQuery to avoid duplicate network requests.',
        });
      }
    }

    if (action === 'refetch' || action === 'queryRefetch') {
      const now = Date.now();
      refetchTimestamps.push(now);
      refetchTimestamps = refetchTimestamps.filter(t => now - t < REFETCH_WINDOW_MS);

      if (refetchTimestamps.length >= REFETCH_THRESHOLD) {
        warnings.push({
          adapterName: 'TanStackQuery',
          type: 'EXCESSIVE_REFETCH',
          message: `Query ${queryKey} refetched ${refetchTimestamps.length} times in ${REFETCH_WINDOW_MS / 1000}s — excessive refetching.`,
          recommendation: 'Check staleTime and refetchInterval configuration. Increase staleTime to reduce refetches.',
        });
      }
    }

    return originalSubscribe(event);
  }) as typeof originalSubscribe;
}

// ── Manual attachment ────────────────────────────────────────

export function attachToQueryClient(queryClient: {
  getQueryCache?: () => { subscribe: (fn: (event: any) => void) => () => void };
}): void {
  try {
    const cache = queryClient.getQueryCache?.();
    if (cache) instrumentCache(cache);
  } catch {
    // Non-blocking
  }
}

// ── Adapter ──────────────────────────────────────────────────

let _detached = false;

export const TanStackQueryAdapter: StateAdapter = {
  name: 'TanStackQuery',

  attach(): void {
    _detached = false;

    try {
      const _require = createRequire(fileURLToPath(import.meta.url));
      const queryCore = _require('@tanstack/query-core') as any;

      const QueryClient = queryCore?.QueryClient;
      if (typeof QueryClient !== 'function') return;

      // Patch the prototype's getQueryCache to instrument the first call
      const protoGetCache = QueryClient.prototype.getQueryCache;
      if (typeof protoGetCache !== 'function') return;

      QueryClient.prototype.getQueryCache = function (...args: unknown[]) {
        const cache = protoGetCache.apply(this, args);
        if (cache && !_detached) {
          instrumentCache(cache);
        }
        return cache;
      };
    } catch {
      // @tanstack/query-core not installed
    }
  },

  detach(): void {
    _detached = true;
    observedKeys.clear();
    refetchTimestamps = [];
  },
};
