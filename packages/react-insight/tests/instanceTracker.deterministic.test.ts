/**
 * Instance tracker — deterministic test suite (gates CI).
 *
 * Two categories of assertions that must be provably correct without
 * relying on garbage collection timing:
 *
 * 1. **Dual-buffering stability:** Two Fiber-like objects representing the
 *    same component instance (same tree path, type, key) must yield the
 *    same synthetic instance ID, even if the object reference is different.
 *    This is the core "Fiber identity is unstable" fix.
 *
 * 2. **Explicit cleanup:** Simulating mount + unmount via the explicit
 *    `trackInstanceCleanup()` path must clear history buffers immediately
 *    and deterministically, regardless of GC state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getInstanceId,
  trackInstance,
  trackInstanceCleanup,
  incrementRenderCount,
  _resetHistoryStore,
  _historyStoreSize,
  _getHistory,
} from '../src/engine/instanceTracker';
import { probeAdapter, type FiberAdapter } from '../src/engine/FiberAdapter';

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Create a mock Fiber-like object for testing.
 *
 * The probeAdapter uses `.tag`, `.type`, `.key`, `.return`, `.child`,
 * `.sibling`, `.stateNode`, and `._debugSource` — all optional fields.
 * This simulates the shape that React's Fiber objects have at runtime
 * without importing React.
 */
function mockFiber(overrides: Record<string, unknown> = {}): unknown {
  return {
    tag: 0,          // FunctionComponent
    type: 'TestComp',
    key: null,
    return: null,
    child: null,
    sibling: null,
    stateNode: null,
    _debugSource: null,
    ...overrides,
  };
}

/**
 * Create a chain of fibers representing a component tree.
 * Returns the root fiber. Children are set up as child/sibling links.
 *
 * @param types - Components from root to leaf, e.g. ['App', 'ExpenseTable', 'ExpenseRow']
 */
function createTree(types: string[]): unknown {
  let root: unknown | null = null;
  let prev: unknown | null = null;

  for (let i = 0; i < types.length; i++) {
    const fiber = mockFiber({
      tag: 0,
      type: types[i],
      key: null,
      stateNode: null,
    });

    if (root === null) {
      root = fiber;
    }
    if (prev !== null) {
      (prev as any).child = fiber;
      (fiber as any).return = prev;
    }
    prev = fiber;
  }

  // Set siblings so there are multiple children at the leaf level
  // e.g. App → ExpenseTable → [ExpenseRow, ExpenseRow, ExpenseRow]
  return root;
}

function createTreeWithSiblings(types: string[], siblingCount: number): unknown {
  const root = createTree(types);
  // Walk to the leaf
  let leaf: any = root as any;
  while (leaf?.child) leaf = leaf.child;

  // Add siblings at the leaf level
  let lastSibling = leaf as any;
  for (let i = 0; i < siblingCount; i++) {
    const sibling = mockFiber({
      tag: 0,
      type: types[types.length - 1],
      key: i === 0 ? null : `row-${i}`,
    });
    (sibling as any).return = leaf.return;
    lastSibling.sibling = sibling;
    lastSibling = sibling as any;
  }

  return root;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('instanceTracker — deterministic', () => {
  beforeEach(() => {
    _resetHistoryStore();
  });

  describe('getInstanceId (synthetic ID stability)', () => {
    it('returns consistent IDs for structurally identical fibers', () => {
      const fiberA = mockFiber({ type: 'App', key: null, child: null, sibling: null });
      const fiberB = mockFiber({ type: 'App', key: null, child: null, sibling: null });

      const idA = getInstanceId(fiberA, probeAdapter);
      const idB = getInstanceId(fiberB, probeAdapter);

      // Even though fiberA and fiberB are different objects with no parent
      // (return = null), their tree path is the same: they're both roots.
      expect(idA).toBe(idB);
    });

    it('produces different IDs for different component types', () => {
      const app = mockFiber({ type: 'App' });
      const nav = mockFiber({ type: 'Nav' });

      expect(getInstanceId(app, probeAdapter)).not.toBe(getInstanceId(nav, probeAdapter));
    });

    it('incorporates the key prop into the ID', () => {
      const row1 = getInstanceId(
        mockFiber({ type: 'ExpenseRow', key: 'row-1' }),
        probeAdapter,
      );
      const row2 = getInstanceId(
        mockFiber({ type: 'ExpenseRow', key: 'row-2' }),
        probeAdapter,
      );

      expect(row1).not.toBe(row2);
    });

    it('returns same ID for different object references with same structure', () => {
      // Simulate dual-buffering: two Fiber objects for the same instance
      const app: any = mockFiber({ type: 'App' });
      const child1: any = mockFiber({ type: 'Header' });
      app.child = child1;
      child1.return = app;

      // "work-in-progress" version — new object, same tree position
      const appWip: any = mockFiber({ type: 'App' });
      const child1Wip: any = mockFiber({ type: 'Header' });
      appWip.child = child1Wip;
      child1Wip.return = appWip;

      const idCurrent = getInstanceId(child1, probeAdapter);
      const idWip = getInstanceId(child1Wip, probeAdapter);

      // Same tree path = same instance ID, even though object refs differ
      expect(idCurrent).toBe(idWip);
    });

    it('produces deterministic IDs in a sibling chain', () => {
      // App → [Header, Main, Footer]
      const app: any = mockFiber({ type: 'App' });
      const header: any = mockFiber({ type: 'Header', return: app });
      const main: any = mockFiber({ type: 'Main', return: app });
      const footer: any = mockFiber({ type: 'Footer', return: app });
      app.child = header;
      header.sibling = main;
      main.sibling = footer;

      expect(getInstanceId(header, probeAdapter)).toBe('Header||0');
      expect(getInstanceId(main, probeAdapter)).toBe('Main||1');
      expect(getInstanceId(footer, probeAdapter)).toBe('Footer||2');
    });
  });

  describe('explicit cleanup path (deterministic, gates CI)', () => {
    it('trackInstance creates a history entry', () => {
      const fiber = mockFiber({ type: 'MyComponent' });
      const id = trackInstance(fiber, probeAdapter);

      expect(_historyStoreSize()).toBe(1);
      expect(_getHistory(id)).toBeDefined();
    });

    it('trackInstanceCleanup removes the history entry immediately', () => {
      const fiber = mockFiber({ type: 'MyComponent' });
      const id = trackInstance(fiber, probeAdapter);

      expect(_historyStoreSize()).toBe(1);

      trackInstanceCleanup(id);

      expect(_historyStoreSize()).toBe(0);
      expect(_getHistory(id)).toBeUndefined();
    });

    it('simulates 1,000 mount/unmount cycles deterministically', () => {
      const componentType = 'Benchmark';
      const ids: string[] = [];

      // Mount 1,000 unique instances (different keys)
      for (let i = 0; i < 1000; i++) {
        const fiber = mockFiber({ type: componentType, key: `item-${i}` });
        const id = trackInstance(fiber, probeAdapter);
        ids.push(id);
      }

      expect(_historyStoreSize()).toBe(1000);

      // Unmount all 1,000 via explicit cleanup
      for (const id of ids) {
        trackInstanceCleanup(id);
      }

      // Store must be empty — clean, deterministic, no GC dependency
      expect(_historyStoreSize()).toBe(0);
    });

    it('mounting the same key multiple times reuses the same history slot', () => {
      const fiber = mockFiber({ type: 'Reused', key: 'same-key' });

      // First mount
      const id1 = trackInstance(fiber, probeAdapter);
      expect(_historyStoreSize()).toBe(1);

      // Second mount with same key (simulating keyed reconciliation)
      const fiber2 = mockFiber({ type: 'Reused', key: 'same-key' });
      const id2 = trackInstance(fiber2, probeAdapter);

      // Same ID means same history slot
      expect(id1).toBe(id2);
      // Store size should still be 1 (no duplicate entry created)
      expect(_historyStoreSize()).toBe(1);
    });

    it('incrementRenderCount bumps the counter', () => {
      const fiber = mockFiber({ type: 'Counter' });
      const id = trackInstance(fiber, probeAdapter);

      const history = _getHistory(id)!;
      expect(history.renderCount).toBe(0);

      incrementRenderCount(id);
      expect(_getHistory(id)!.renderCount).toBe(1);

      incrementRenderCount(id);
      incrementRenderCount(id);
      expect(_getHistory(id)!.renderCount).toBe(3);
    });

    it('componentName is derived from the type string', () => {
      const fiber = mockFiber({ type: 'Dashboard' });
      const id = trackInstance(fiber, probeAdapter);

      expect(_getHistory(id)!.componentName).toBe('Dashboard');
    });
  });
});

// Helper referenced by the gc smoke test — re-export for convenience
export { mockFiber, _resetHistoryStore };
