/**
 * Callbacks that React Insight registers on the DevTools global hook.
 */
export interface HookCallbacks {
  onCommitFiberRoot: (rendererID: number, root: unknown, priorityLevel?: number) => void;
}

/**
 * Minimum interface that the DevTools global hook must expose for
 * React's renderer to initialize successfully.
 *
 * These are the fields React's reconciler checks/sets during module init.
 */
export interface DevToolsHook {
  isDisabled: boolean;
  supportsFiber: boolean;
  inject: (renderer: unknown) => unknown;
  onScheduleFiberRoot: (rendererID: number, root: unknown) => void;
  onCommitFiberRoot: (rendererID: number, root: unknown, priorityLevel?: number) => void;
  onCommitFiberUnmount: (rendererID: number, root: unknown) => void;
  /** Internal storage for the renderer interface injected by React. */
  renderer?: unknown;
  [key: string]: unknown;
}

/**
 * Install or wrap the DevTools global hook.
 *
 * **Must be called BEFORE react-dom is imported.**
 *
 * React's reconciler reads `__REACT_DEVTOOLS_GLOBAL_HOOK__` during its own
 * module initialization. If the hook object doesn't exist at that point,
 * React silently skips all instrumentation — no amount of later patching
 * will retroactively trigger the initial renderer injection. This is a
 * load-order property, not recoverable at runtime.
 *
 * Consumers MUST import React Insight's entry as the very first import
 * in their app's entry module:
 *
 * ```ts
 * // ✅ Correct — shim runs before react-dom is loaded
 * import 'react-insight';
 * import { createRoot } from 'react-dom/client';
 * ```
 *
 * ```ts
 * // ❌ Wrong — react-dom already initialized without finding the hook
 * import { createRoot } from 'react-dom/client';
 * import 'react-insight';
 * ```
 *
 * **CJS vs ESM:** React's CJS development bundles reference
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__` as a bare global — resolved from module
 * scope to `globalThis`. ESM builds may read it from `window`. This
 * function sets the hook on `targetWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__`,
 * `globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__`, and `global.__REACT_DEVTOOLS_GLOBAL_HOOK__`
 * to guarantee discovery regardless of module system.
 */
export function installOrWrapHook(
  targetWindow: Window & typeof globalThis,
  callbacks: HookCallbacks,
): DevToolsHook {
  // Check the window first, then globalThis for existing hooks.
  // React's CJS bundles read from the bare global (globalThis), not from window.
  const windowHook: DevToolsHook | undefined =
    (targetWindow as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const globalHook: DevToolsHook | undefined =
    (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;

  const existingHook = windowHook || globalHook;

  if (existingHook) {
    return wrapExistingHook(targetWindow, existingHook, callbacks);
  }

  return createFreshHook(targetWindow, callbacks);
}

/**
 * Remove the hook from all globals (for test cleanup).
 * @internal
 */
export function _removeHook(): void {
  delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  try { delete (global as any).__REACT_DEVTOOLS_GLOBAL_HOOK__; } catch { /* noop */ }
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function setHookOnGlobals(
  targetWindow: Window & typeof globalThis,
  hook: DevToolsHook,
): void {
  // Set on the window object (ESM/browser path)
  (targetWindow as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  // Set on globalThis (CJS/Node path)
  (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  // Set on global (CJS compat)
  try { (global as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook; } catch { /* noop */ }
}

function createFreshHook(
  targetWindow: Window & typeof globalThis,
  callbacks: HookCallbacks,
): DevToolsHook {
  const hook: DevToolsHook = {
    isDisabled: false,
    supportsFiber: true,

    inject(renderer: unknown) {
      hook.renderer = renderer;
      return renderer;
    },

    onScheduleFiberRoot(_rendererID: number, _root: unknown) {
      // No-op: we only care about committed roots.
    },

    onCommitFiberRoot(rendererID: number, root: unknown, _priorityLevel?: number) {
      try {
        callbacks.onCommitFiberRoot(rendererID, root);
      } catch {
        // Instrumentation Guard (§6.1 of spec): errors in the commit-phase
        // interceptor must be caught here so they never propagate into
        // React's own commit process.
      }
    },

    onCommitFiberUnmount(_rendererID: number, _root: unknown) {
      // No-op for now — will handle cleanup in Phase 2.
    },
  };

  setHookOnGlobals(targetWindow, hook);
  return hook;
}

function wrapExistingHook(
  targetWindow: Window & typeof globalThis,
  existingHook: DevToolsHook,
  callbacks: HookCallbacks,
): DevToolsHook {
  const wrapped: DevToolsHook = {
    isDisabled: existingHook.isDisabled,
    supportsFiber: existingHook.supportsFiber,
    renderer: existingHook.renderer,

    inject(renderer: unknown) {
      return existingHook.inject?.(renderer);
    },

    onScheduleFiberRoot(rendererID: number, root: unknown) {
      return existingHook.onScheduleFiberRoot?.(rendererID, root);
    },

    onCommitFiberRoot(rendererID: number, root: unknown, priorityLevel?: number) {
      // Forward to the original DevTools extension first
      existingHook.onCommitFiberRoot?.(rendererID, root, priorityLevel);

      // Then run our own callback, isolated from errors
      try {
        callbacks.onCommitFiberRoot(rendererID, root);
      } catch {
        // Instrumentation Guard — never throw into React's commit phase
      }
    },

    onCommitFiberUnmount(rendererID: number, root: unknown) {
      return existingHook.onCommitFiberUnmount?.(rendererID, root);
    },
  };

  // Copy over any additional properties/methods the original hook exposes
  // (e.g., checkDCE, rendererInterfaces, etc.) so nothing is lost.
  for (const key of Object.getOwnPropertyNames(existingHook)) {
    if (!(key in wrapped)) {
      try {
        (wrapped as unknown as Record<string, unknown>)[key] =
          (existingHook as unknown as Record<string, unknown>)[key];
      } catch {
        // Skip properties that can't be read (e.g., getter-only).
      }
    }
  }

  setHookOnGlobals(targetWindow, wrapped);
  return wrapped;
}
