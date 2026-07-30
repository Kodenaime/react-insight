/**
 * ErrorBoundary — wraps the React Insight UI overlay.
 *
 * ## Two Independent Failure Surfaces (spec §6.1)
 *
 * 1. **UI Boundary (this component):** The React Insight overlay/drawer
 *    component tree is wrapped in this Error Boundary. A crash here logs
 *    a single console.warn and unmounts only the overlay — never the host app.
 *
 * 2. **Instrumentation Guard (hookShim.ts):** The commit-phase interceptor
 *    (`onCommitFiberRoot`) runs as plain synchronous JS outside any component
 *    tree, wrapped in try/catch at the call site. A boundary around the
 *    overlay cannot catch a throw there.
 *
 * These are independent. This component addresses only #1.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /** Optional fallback rendered in place of the crashed UI. */
  fallback?: ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Single console warning — per spec, the host app must not be affected
    console.warn(
      '[React Insight] UI overlay crashed and has been unmounted. ' +
      'The host application is unaffected.',
      error,
      info?.componentStack,
    );
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Render the fallback, or render nothing (which removes the portal)
      return this.props.fallback ?? null;
    }

    return this.props.children;
  }
}
