import type { ReactNode } from 'react';

/**
 * ─── CRITICAL LOAD-ORDER WARNING ───────────────────────────────────────
 *
 * This file calls `installOrWrapHook` at MODULE SCOPE (top-level).
 *
 * React's reconciler reads `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` during its
 * OWN module initialization — before any component renders, before any hook
 * call, before the user's app code runs. If the hook object doesn't exist at
 * that exact moment, React silently skips all devtools instrumentation, and
 * no amount of later patching can retroactively trigger the initial renderer
 * injection.
 *
 * THEREFORE the consumer MUST import this module as the VERY FIRST import
 * in their app's entry file, before any react-dom import:
 *
 * ```ts
 * // ✅ Correct — hook shim installs before react-dom initializes
 * import 'react-insight';
 * import { createRoot } from 'react-dom/client';
 * ```
 *
 * ```ts
 * // ❌ Wrong — react-dom already checked for the hook and it wasn't there
 * import { createRoot } from 'react-dom/client';
 * import 'react-insight';
 * ```
 *
 * This is not a React bug — it is a deliberate design constraint of the
 * DevTools hook protocol. We document it here because violating it is the
 * single most common misconfiguration of this library.
 * ──────────────────────────────────────────────────────────────────────
 */

import { installOrWrapHook } from './fiber/hookShim';
import type { HookCallbacks } from './fiber/hookShim';
import { ReactInsightEngine } from './engine/ReactInsightEngine';

// Install the shim at module scope — this runs when the module is first
// imported, which must happen before any react-dom import in the consumer.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  installOrWrapHook(window, {
    onCommitFiberRoot(rendererID, root) {
      // `root` is the FiberRootNode passed by React's reconciler.
      // `root.current` is the HostRoot fiber (tag 3) — that's where we
      // start walking the committed tree.
      const fiberRoot: unknown = (root as any)?.current;
      if (fiberRoot) {
        ReactInsightEngine.analyzeCommit(fiberRoot, rendererID);
      }
    },
  } satisfies HookCallbacks);
}

/**
 * Props for the top-level <ReactInsight /> component.
 */
export interface ReactInsightProps {
  /** Enable or disable the entire tool. Default: process.env.NODE_ENV === 'development' */
  enabled?: boolean;
  /** Key-name patterns to mask in displayed prop/state values. */
  maskKeys?: (string | RegExp)[];
  /** Value-shape patterns to mask (jwt, creditCard, bearerToken, etc.). */
  maskValuePatterns?: string[];
  /** Enable value masking entirely. Default: true */
  enableMasking?: boolean;
  /** Child application tree. */
  children?: ReactNode;
}

/**
 * Development entry for React Insight.
 *
 * At this stage the component is a minimal wrapper — the full engine,
 * overlay drawer, and visualizer will be wired in during Phase 2–4.
 */
export function ReactInsight({ enabled, maskKeys, maskValuePatterns, enableMasking, children }: ReactInsightProps) {
  // TODO(Phase 4): wire overlay portal, error boundary, masking pipeline
  const active = enabled ?? true;
  if (!active) return <>{children}</>;

  // This hook call will later collect runtime telemetry
  return <>{children}</>;
}

export default ReactInsight;
