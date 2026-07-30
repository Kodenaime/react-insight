import type { ReactNode } from 'react';
import { installOrWrapHook } from './fiber/hookShim';
import type { HookCallbacks } from './fiber/hookShim';
import { ReactInsightEngine } from './engine/ReactInsightEngine';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { OverlayDrawer, OverlayCrashFallback } from './ui/OverlayDrawer';

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  installOrWrapHook(window, {
    onCommitFiberRoot(rendererID, root) {
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
 * Wraps the host app, attaches the overlay portal (inside ErrorBoundary),
 * and passes through children unmodified.
 */
export function ReactInsight({
  enabled,
  maskKeys,
  maskValuePatterns,
  enableMasking,
  children,
}: ReactInsightProps) {
  const active = enabled ?? true;
  if (!active) return <>{children}</>;

  return (
    <>
      {children}
      <ErrorBoundary fallback={<OverlayCrashFallback />}>
        <OverlayDrawer />
      </ErrorBoundary>
    </>
  );
}

export default ReactInsight;
