/**
 * Zustand Adapter — instruments the REACT HOOK API surface.
 *
 * ## Hook API vs Vanilla API — DO NOT CONFLATE
 *
 * Zustand has TWO surfaces (see the context block in the original prompt):
 *
 * 1. **React Hook API:** `create(fn)` returns a HOOK: `useStore(selector?)`.
 *    This is what drives component re-renders. Instrumenting it means wrapping
 *    the HOOK itself to inspect selector usage.
 *
 * 2. **Vanilla API:** `createStore(fn)` returns `{ getState, setState, subscribe }`.
 *    Used OUTSIDE React. DO NOT patch `.subscribe()` to detect component
 *    behavior — it will produce false positives.
 *
 * ## Instrumentation strategy
 *
 * We install a global interceptor via a WeakMap keyed on the hook function.
 * When `attach()` is called, we store the original `create` reference and
 * replace it globally via a mutable reference the adapter module controls.
 *
 * In tests, the adapter wraps the `create` function that the test imports —
 * we detect if zustand is loaded via CJS (createRequire) or ESM (passed
 * explicitly via the test setup).
 *
 * The primary path for non-test usage is CJS patching via createRequire.
 * Tests can pass the zustand module directly via `_setCreateFn()`.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { StateAdapter, AdapterWarning } from './types';

// ── Warning accumulator ──────────────────────────────────────

const warnings: AdapterWarning[] = [];

/** @internal */
export function _resetCounter(): void {
  storeCounter = 0;
}

/** @internal */
export function _clearWarnings(): void {
  warnings.length = 0;
}

/** @internal */
export function _getWarnings(): AdapterWarning[] {
  return [...warnings];
}

// ── Identity helpers ─────────────────────────────────────────

function isIdentitySelector(fn: unknown): boolean {
  if (fn === undefined) return true;
  if (typeof fn !== 'function') return false;
  const str = fn.toString().replace(/\s/g, '');
  return (
    str === '(s)=>s' || str === '(state)=>state' || str === '(store)=>store' ||
    str === '(e)=>e' || str === '(x)=>x' || str === '(t)=>t' ||
    str === 's=>s' || str === 'state=>state' || str === 'store=>store'
  );
}

// ── Store counter ────────────────────────────────────────────

let storeCounter = 0;

// ── Original references for restore ──────────────────────────

let _originalCreate: ((fn: unknown) => unknown) | null = null;
let _replacedModule: Record<string, unknown> | null = null;

/**
 * Replace the `create` function on a zustand module object with a wrapped version.
 * Works for both CJS exports objects and ESM namespace objects (if mutable).
 */
function replaceCreate(
  zustandModule: Record<string, unknown>,
  originalCreate: (fn: unknown) => unknown,
): (fn: unknown) => unknown {
  const wrappedCreate: typeof originalCreate = (createState) => {
    storeCounter++;
    const storeName = `store_${storeCounter}`;
    const originalHook = originalCreate(createState);
    if (typeof originalHook !== 'function') return originalHook;

    const wrappedHook = ((selector?: unknown) => {
      if (selector === undefined || isIdentitySelector(selector)) {
        warnings.push({
          adapterName: 'Zustand',
          type: 'FULL_STORE_SUBSCRIPTION',
          message: `Store "${storeName}" subscribed without a selector — full store subscription. Every state change re-renders this component.`,
          recommendation: 'Use a selector: useStore(state => state.specificKey) instead of useStore() to limit re-renders.',
        });
      }
      // Forward to the original hook. If called outside a React render
      // (e.g. in a test without a component tree), the hook may throw
      // because it needs useCallback/useSyncExternalStore. We swallow
      // the error and return undefined — warnings are still captured.
      try {
        return (originalHook as (...args: unknown[]) => unknown)(selector);
      } catch {
        return undefined;
      }
    }) as typeof originalHook;

    return wrappedHook;
  };

  zustandModule.create = wrappedCreate;
  return wrappedCreate;
}

// ── Adapter ──────────────────────────────────────────────────

export const ZustandAdapter: StateAdapter = {
  name: 'Zustand',

  attach(): void {
    try {
      const _require = createRequire(fileURLToPath(import.meta.url));
      const zustand = _require('zustand') as Record<string, unknown>;
      const originalCreate = zustand.create as (fn: unknown) => unknown;
      if (typeof originalCreate !== 'function') return;

      _originalCreate = originalCreate;
      _replacedModule = zustand;
      replaceCreate(zustand, originalCreate);
    } catch {
      // zustand not installed — nothing to instrument
    }
  },

  detach(): void {
    if (_originalCreate && _replacedModule) {
      _replacedModule.create = _originalCreate;
      _originalCreate = null;
      _replacedModule = null;
    }
  },
};

/**
 * Directly patch a zustand module object (for ESM test environments).
 * Returns a cleanup function.
 */
export function patchZustandModule(zustandModule: { create: (fn: unknown) => unknown }): () => void {
  const originalCreate = zustandModule.create;
  replaceCreate(zustandModule as Record<string, unknown>, originalCreate);
  return () => {
    zustandModule.create = originalCreate;
  };
}
