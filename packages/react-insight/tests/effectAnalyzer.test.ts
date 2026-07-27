/**
 * Effect Analyzer — test suite.
 *
 * Covers dependency change detection, index reporting, unbounded effect
 * warnings, StrictMode filtering, and Offscreen boundary classification.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  analyzeEffects,
  _resetEffectStore,
  _getEffectStore,
} from '../src/engine/effectAnalyzer';
import { probeAdapter } from '../src/engine/FiberAdapter';

// ── Helpers ────────────────────────────────────────────────

/**
 * Create a mock effect hook with the given dependency array.
 * We simulate the effect structure React stores in the hook linked list.
 */
function mockEffectHook(deps: unknown[] | null, hookIndex: number = 0) {
  return {
    memoizedState: {
      tag: 0,
      create: () => {},
      destroy: null,
      deps,
      flags: 0,
    },
    baseState: null,
    baseQueue: null,
    queue: {
      lastRenderedState: {
        tag: 0,
        create: () => {},
        destroy: null,
        deps,
        flags: 0,
      },
      pending: null,
      dispatch: null,
    },
    next: null,
  };
}

/**
 * Create a chain of multiple effect hooks.
 */
function createEffectHookChain(depsList: Array<unknown[] | null>): unknown {
  const hooks: any[] = [];
  for (let i = 0; i < depsList.length; i++) {
    hooks.push(mockEffectHook(depsList[i], i));
  }
  // Link them
  for (let i = 0; i < hooks.length - 1; i++) {
    hooks[i].next = hooks[i + 1];
  }
  return hooks[0]; // return head
}

function mockFiber(effects: unknown): unknown {
  return {
    tag: 0,
    type: 'EffectfulComp',
    key: null,
    return: null,
    child: null,
    sibling: null,
    stateNode: null,
    _debugSource: null,
    memoizedProps: {},
    memoizedState: effects,
  };
}

const INSTANCE_ID = 'EffectfulComp||0';
const COMPONENT_NAME = 'EffectfulComp';

describe('effectAnalyzer — analyzeEffects', () => {
  beforeEach(() => {
    _resetEffectStore();
  });

  // ── FIRST_MOUNT ──────────────────────────────────────────

  describe('FIRST_MOUNT', () => {
    it('classifies first effect execution as FIRST_MOUNT', () => {
      const fiber = mockFiber(createEffectHookChain([[42]]));
      const result = analyzeEffects(fiber, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      expect(result.instanceId).toBe(INSTANCE_ID);
      expect(result.componentName).toBe(COMPONENT_NAME);
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0].status).toBe('FIRST_MOUNT');
      expect(result.effects[0].wasted).toBe(false);
      expect(result.effects[0].deps).toEqual([42]);
      expect(result.effects[0].prevDeps).toBeNull();
    });

    it('stores deps for next comparison on first call', () => {
      const fiber = mockFiber(createEffectHookChain([[42]]));
      analyzeEffects(fiber, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      const store = _getEffectStore(INSTANCE_ID)!;
      expect(store.depsByIndex.get(0)).toEqual([42]);
    });
  });

  // ── RE_RAN: dependency changes ───────────────────────────

  describe('RE_RAN', () => {
    it('detects value change in deps[0]', () => {
      const fiber1 = mockFiber(createEffectHookChain([['a', 'b']]));
      analyzeEffects(fiber1, probeAdapter, INSTANCE_ID, COMPONENT_NAME); // mount

      const fiber2 = mockFiber(createEffectHookChain([['a', 'c']]));
      const result = analyzeEffects(fiber2, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      expect(result.effects[0].status).toBe('RE_RAN');
      expect(result.effects[0].wasted).toBe(true);
      expect(result.effects[0].changedDeps).toHaveLength(1);
      expect(result.effects[0].changedDeps[0].index).toBe(1);
      expect(result.effects[0].changedDeps[0].changeType).toBe('value');
    });

    it('detects reference change in deps (new object, same values)', () => {
      const obj1 = { x: 1 };
      const fiber1 = mockFiber(createEffectHookChain([[obj1]]));
      analyzeEffects(fiber1, probeAdapter, INSTANCE_ID, COMPONENT_NAME); // mount

      const obj2 = { x: 1 }; // different ref, same values
      const fiber2 = mockFiber(createEffectHookChain([[obj2]]));
      const result = analyzeEffects(fiber2, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      expect(result.effects[0].status).toBe('RE_RAN');
      expect(result.effects[0].changedDeps[0].changeType).toBe('reference');
    });

    it('reports which specific index changed', () => {
      const fiber1 = mockFiber(createEffectHookChain([[1, 2, 3]]));
      analyzeEffects(fiber1, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      const fiber2 = mockFiber(createEffectHookChain([[1, 99, 3]]));
      const result = analyzeEffects(fiber2, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      expect(result.effects[0].changedDeps[0].index).toBe(1);
      expect(result.effects[0].changedDeps[0].prev).toBe(2);
      expect(result.effects[0].changedDeps[0].current).toBe(99);
    });

    it('reports all changed indices in a multi-dep change', () => {
      const fiber1 = mockFiber(createEffectHookChain([[1, 2, 3]]));
      analyzeEffects(fiber1, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      const fiber2 = mockFiber(createEffectHookChain([[10, 2, 30]]));
      const result = analyzeEffects(fiber2, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      expect(result.effects[0].changedDeps).toHaveLength(2);
      expect(result.effects[0].changedDeps[0].index).toBe(0);
      expect(result.effects[0].changedDeps[1].index).toBe(2);
    });

    it('produces a human-readable cause string', () => {
      const fiber1 = mockFiber(createEffectHookChain([['a', 'b']]));
      analyzeEffects(fiber1, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      const fiber2 = mockFiber(createEffectHookChain([['a', 'c']]));
      const result = analyzeEffects(fiber2, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      expect(result.effects[0].cause).toContain('deps[1]');
      expect(result.effects[0].cause).toContain('value changed');
    });
  });

  // ── Empty deps [] ────────────────────────────────────────

  describe('empty deps array', () => {
    it('treats empty deps [] as mount-only', () => {
      const fiber = mockFiber(createEffectHookChain([[]]));
      const result = analyzeEffects(fiber, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      expect(result.effects[0].status).not.toBe('UNBOUNDED');
      expect(result.effects[0].deps).toEqual([]);
    });
  });

  // ── UNBOUNDED (no deps array) ────────────────────────────

  describe('UNBOUNDED_EFFECT_WARNING', () => {
    it('flags useEffect with no deps as UNBOUNDED', () => {
      const fiber = mockFiber(createEffectHookChain([null]));
      const result = analyzeEffects(fiber, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      expect(result.hasUnboundedEffect).toBe(true);
      expect(result.effects[0].status).toBe('UNBOUNDED');
      expect(result.effects[0].wasted).toBe(true);
      expect(result.effects[0].cause).toContain('no dependency array');
    });

    it('flags multiple unbounded effects', () => {
      const fiber = mockFiber(createEffectHookChain([null, null]));
      const result = analyzeEffects(fiber, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      expect(result.hasUnboundedEffect).toBe(true);
      expect(result.effects).toHaveLength(2);
      expect(result.effects[0].status).toBe('UNBOUNDED');
      expect(result.effects[1].status).toBe('UNBOUNDED');
    });
  });

  // ── Multiple effects in one component ───────────────────

  describe('multiple effects', () => {
    it('analyzes all hooks in the linked list', () => {
      const fiber = mockFiber(createEffectHookChain([[1], [2], [3]]));
      const result = analyzeEffects(fiber, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      expect(result.effects).toHaveLength(3);
      expect(result.effects[0].status).toBe('FIRST_MOUNT');
      expect(result.effects[1].status).toBe('FIRST_MOUNT');
      expect(result.effects[2].status).toBe('FIRST_MOUNT');
    });

    it('tracks each effect independently across commits', () => {
      const fiber1 = mockFiber(createEffectHookChain([[1], [2]]));
      analyzeEffects(fiber1, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      // Only the second effect's deps change
      const fiber2 = mockFiber(createEffectHookChain([[1], [99]]));
      const result = analyzeEffects(fiber2, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      // Effect 0: deps [1] === [1] → unchanged, classified as RE_RAN with empty changedDeps
      expect(result.effects[0].status).toBe('RE_RAN');
      expect(result.effects[0].changedDeps).toHaveLength(0);

      // Effect 1: deps [99] !== [2] → change detected
      expect(result.effects[1].status).toBe('RE_RAN');
      expect(result.effects[1].changedDeps).toHaveLength(1);
      expect(result.effects[1].changedDeps[0].index).toBe(0);
    });
  });

  // ── Offscreen boundary ───────────────────────────────────

  describe('OFFSCREEN_REAPPEARANCE', () => {
    it('detects offscreen re-appearance when deps are unchanged', () => {
      // Simulate a component inside an Offscreen boundary with unchanged deps
      const fiber1 = mockFiber(createEffectHookChain([['stable']]));
      // Add Offscreen ancestor on the second call
      const fiber2 = mockFiber(createEffectHookChain([['stable']]));
      // We need to mock the fiber tree with Offscreen ancestor
      (fiber2 as any).return = { tag: 22, type: 'Offscreen', child: fiber2 };

      // First call — normal mount, no Offscreen
      analyzeEffects(fiber1, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      // Second call — Offscreen visibility change, deps unchanged
      const result = analyzeEffects(fiber2, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      expect(result.isOffscreenBound).toBe(true);
      expect(result.effects[0].status).toBe('OFFSCREEN_REAPPEARANCE');
      expect(result.effects[0].wasted).toBe(false);
      expect(result.effects[0].cause).toContain('Offscreen');
    });
  });

  // ── Error and edge cases ─────────────────────────────────

  describe('edge cases', () => {
    it('handles fiber with no memoizedState (no hooks)', () => {
      const fiber = {
        tag: 0,
        type: 'NoHooks',
        memoizedState: null,
      };
      const result = analyzeEffects(fiber, probeAdapter, INSTANCE_ID, COMPONENT_NAME);
      expect(result.effects).toHaveLength(0);
      expect(result.hasUnboundedEffect).toBe(false);
    });

    it('returns empty effects for host components', () => {
      const fiber = {
        tag: 5,
        type: 'div',
        memoizedState: null,
      };
      const result = analyzeEffects(fiber, probeAdapter, 'div||0', 'div');
      expect(result.effects).toHaveLength(0);
    });

    it('tracks isOffscreenBound correctly', () => {
      // No Offscreen ancestor
      const fiber = mockFiber(createEffectHookChain([['x']]));
      const result = analyzeEffects(fiber, probeAdapter, INSTANCE_ID, COMPONENT_NAME);
      expect(result.isOffscreenBound).toBe(false);
    });

    it('resets effect store between tests', () => {
      const fiber = mockFiber(createEffectHookChain([['a']]));
      analyzeEffects(fiber, probeAdapter, INSTANCE_ID, COMPONENT_NAME);

      _resetEffectStore();
      expect(_getEffectStore(INSTANCE_ID)).toBeUndefined();
    });
  });
});
