/**
 * Standard interface for ecosystem adapters.
 *
 * Each adapter wraps a state management library's public API surface to
 * instrument hook calls, detect anti-patterns (unselected subscriptions,
 * over-fetching), and feed telemetry into the React Insight engine.
 *
 * Adapters instrument the LIBRARY'S API, not the Fiber tree — see spec §4
 * for justification.
 */
export interface StateAdapter {
  /** Human-readable library name. */
  name: string;
  /** Attach instrumentation. Called once during engine startup. */
  attach: () => void;
  /** Detach instrumentation and restore originals. Called on unmount / hot reload. */
  detach: () => void;
}

export interface AdapterWarning {
  /** Which adapter emitted this warning. */
  adapterName: string;
  /** Warning type identifier. */
  type: string;
  /** Human-readable warning message. */
  message: string;
  /** Optional recommendation. */
  recommendation?: string;
  /** The component name this warning relates to (if available). */
  componentName?: string;
}
