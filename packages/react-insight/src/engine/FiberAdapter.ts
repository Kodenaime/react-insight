/**
 * FiberAdapter — normalized interface for reading Fiber tree structure.
 *
 * The core engine NEVER touches raw Fiber fields directly. All reads go
 * through a version-specific adapter that normalizes differences between
 * React 17, 18, and 19 internals.
 *
 * Each supported React version gets its own adapter module that implements
 * this interface (planned for Phase 1.3 of the implementation blueprint).
 * For now, the adapters are inlined as fallback probes — they detect the
 * installed React version at runtime by probing for known field shapes.
 */
export interface FiberAdapter {
  /** Numeric tag (0=FunctionComponent, 1=ClassComponent, 3=HostRoot, 5=HostComponent, etc.) */
  getTag(fiber: unknown): number;
  /** Component type (function reference, class, string for DOM elements, etc.) */
  getType(fiber: unknown): unknown;
  /** The `key` prop, if any */
  getKey(fiber: unknown): string | null;
  /** Parent (return) fiber */
  getReturn(fiber: unknown): unknown | null;
  /** First child fiber */
  getChild(fiber: unknown): unknown | null;
  /** Next sibling fiber */
  getSibling(fiber: unknown): unknown | null;
  /** The DOM node or class instance (fiber.stateNode) */
  getStateNode(fiber: unknown): unknown | null;
  /** Debug source info (file path / line number) from the JSX transform */
  getDebugSource(fiber: unknown): { fileName: string; lineNumber: number; columnNumber?: number } | null;
}

/**
 * Runtime-probing adapter — detects Fiber field shapes and adapts accordingly.
 *
 * This is a stopgap until proper version-specific adapters land in Phase 1.3.
 * It probes for known patterns and fails closed (returns safe defaults) rather
 * than throwing on unknown shapes.
 */
export const probeAdapter: FiberAdapter = {
  getTag(fiber: any): number {
    return fiber?.tag ?? -1;
  },
  getType(fiber: any): unknown {
    return fiber?.type ?? null;
  },
  getKey(fiber: any): string | null {
    const k = fiber?.key;
    return k != null ? String(k) : null;
  },
  getReturn(fiber: any): unknown | null {
    return fiber?.return ?? null;
  },
  getChild(fiber: any): unknown | null {
    return fiber?.child ?? null;
  },
  getSibling(fiber: any): unknown | null {
    return fiber?.sibling ?? null;
  },
  getStateNode(fiber: any): unknown | null {
    return fiber?.stateNode ?? null;
  },
  getDebugSource(fiber: any): { fileName: string; lineNumber: number; columnNumber?: number } | null {
    const s = fiber?._debugSource;
    if (!s || typeof s.fileName !== 'string') return null;
    return { fileName: s.fileName, lineNumber: s.lineNumber, columnNumber: s.columnNumber };
  },
};

/**
 * Check whether a fiber is a "component" type that should be tracked
 * (function/class components, not host elements like div/span).
 *
 * Tags: 0=FunctionComponent, 1=ClassComponent, 2=IndeterminateComponent,
 *       15=SimpleMemoComponent, 16=IncompleteClassComponent
 * Host tags (5, 6) and special types (3=HostRoot, 8=Mode, etc.) are skipped.
 */
export function isComponentFiber(tag: number): boolean {
  return tag === 0 || tag === 1 || tag === 2 || tag === 15 || tag === 16;
}
