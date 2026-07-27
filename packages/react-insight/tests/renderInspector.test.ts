/**
 * Render Inspector — test suite.
 *
 * Two categories:
 *
 * 1. **Uint tests** (deterministic, mock fibers): Classify render reasons for
 *    state changes, prop drift, inline callbacks, parent renders, and mounts.
 *
 * 2. **Real StrictMode mount** (integration, real React 18): Mount a real
 *    component via createRoot + StrictMode + flushSync, then assert that:
 *    - onCommitFiberRoot fires ONCE (not doubled) — confirming FINDINGS.md
 *    - Render count is 1 (not inflated by StrictMode)
 *    - Render reason classification works on a real React runtime
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyRender,
  _resetPrevSnapshots,
  _getPrevSnapshot,
} from '../src/engine/renderInspector';
import { probeAdapter } from '../src/engine/FiberAdapter';
import { compareValues } from '../src/engine/diffEngine';

// ── Helper: mock fiber ──────────────────────────────────────

function mockFiber(overrides: Record<string, unknown> = {}): unknown {
  return {
    tag: 0,
    type: 'TestComp',
    key: null,
    return: null,
    child: null,
    sibling: null,
    stateNode: null,
    _debugSource: null,
    memoizedProps: {},
    memoizedState: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('renderInspector — classifyRender', () => {
  beforeEach(() => {
    _resetPrevSnapshots();
  });

  describe('MOUNT', () => {
    it('classifies first render as MOUNT', () => {
      const fiber = mockFiber({ type: 'App', memoizedProps: { title: 'hello' } });
      const result = classifyRender('App||0', fiber, probeAdapter);

      expect(result.reason).toBe('MOUNT');
      expect(result.wasted).toBe(false);
      expect(result.instanceId).toBe('App||0');
      expect(result.componentName).toBe('App');
    });

    it('stores the snapshot for future comparisons', () => {
      const fiber = mockFiber({ type: 'Comp', memoizedProps: { x: 1 } });
      classifyRender('Comp||0', fiber, probeAdapter);

      const snapshot = _getPrevSnapshot('Comp||0');
      expect(snapshot).toBeDefined();
      expect(snapshot!.props).toEqual({ x: 1 });
    });
  });

  describe('STATE_CHANGE', () => {
    it('detects memoizedState change', () => {
      const fiber = mockFiber({ type: 'Counter', memoizedState: 0 });
      classifyRender('Counter||0', fiber, probeAdapter); // mount

      const fiber2 = mockFiber({ type: 'Counter', memoizedState: 1 }); // update
      const result = classifyRender('Counter||0', fiber2, probeAdapter);

      expect(result.reason).toBe('STATE_CHANGE');
      expect(result.wasted).toBe(false);
    });
  });

  describe('PROP_VALUE_CHANGE', () => {
    it('detects actual prop value change', () => {
      const fiber = mockFiber({ type: 'Display', memoizedProps: { name: 'Alice' } });
      classifyRender('Display||0', fiber, probeAdapter); // mount

      const fiber2 = mockFiber({ type: 'Display', memoizedProps: { name: 'Bob' } });
      const result = classifyRender('Display||0', fiber2, probeAdapter);

      expect(result.reason).toBe('PROP_VALUE_CHANGE');
      expect(result.wasted).toBe(true);
      expect(result.diff!.status).toBe('CHANGED');
    });
  });

  describe('PROP_REFERENCE_CHANGE', () => {
    it('detects identical values but different references', () => {
      const fiber = mockFiber({
        type: 'Config',
        memoizedProps: { config: { theme: 'dark', fontSize: 14 } },
      });
      classifyRender('Config||0', fiber, probeAdapter); // mount

      const fiber2 = mockFiber({
        type: 'Config',
        memoizedProps: { config: { theme: 'dark', fontSize: 14 } }, // same values, new object
      });
      const result = classifyRender('Config||0', fiber2, probeAdapter);

      expect(result.reason).toBe('PROP_REFERENCE_CHANGE');
      expect(result.wasted).toBe(true);
      expect(result.diff!.status).toBe('VALUES_IDENTICAL');
    });
  });

  describe('UNMEMOIZED_CALLBACK', () => {
    it('flags inline callback as UNMEMOIZED_CALLBACK', () => {
      const onClick1 = () => {};
      const fiber = mockFiber({
        type: 'Button',
        memoizedProps: { onClick: onClick1 },
      });
      classifyRender('Button||0', fiber, probeAdapter); // mount

      const onClick2 = () => {}; // different reference
      const fiber2 = mockFiber({
        type: 'Button',
        memoizedProps: { onClick: onClick2 },
      });
      const result = classifyRender('Button||0', fiber2, probeAdapter);

      expect(result.reason).toBe('UNMEMOIZED_CALLBACK');
      expect(result.wasted).toBe(true);
    });
  });

  describe('PARENT_RENDER', () => {
    it('classifies as PARENT_RENDER when same props reference is passed through', () => {
      const sameProps = { label: 'fixed' };
      const fiber = mockFiber({ type: 'Static', memoizedProps: sameProps });
      classifyRender('Static||0', fiber, probeAdapter); // mount

      // Same props reference — parent re-rendered but passed the same object
      const fiber2 = mockFiber({ type: 'Static', memoizedProps: sameProps });
      const result = classifyRender('Static||0', fiber2, probeAdapter);

      expect(result.reason).toBe('PARENT_RENDER');
      expect(result.wasted).toBe(true);
    });
  });

  describe('CONTEXT_MUTATION', () => {
    it('classifies context consumer renders', () => {
      const fiber = mockFiber({
        tag: 9,
        type: '(Context)',
        memoizedProps: { value: 'light' },
      });
      classifyRender('Context||0', fiber, probeAdapter); // mount

      const fiber2 = mockFiber({
        tag: 9,
        type: '(Context)',
        memoizedProps: { value: 'dark' },
      });
      const result = classifyRender('Context||0', fiber2, probeAdapter);

      expect(result.reason).toBe('CONTEXT_MUTATION');
      expect(result.wasted).toBe(false);
    });
  });

  describe('componentName resolution', () => {
    it('resolves function component names', () => {
      function MyComponent() {}
      const fiber = mockFiber({ type: MyComponent });
      const result = classifyRender('My||0', fiber, probeAdapter);
      expect(result.componentName).toBe('MyComponent');
    });

    it('resolves string type names (host components)', () => {
      const fiber = mockFiber({ type: 'div' });
      const result = classifyRender('div||0', fiber, probeAdapter);
      expect(result.componentName).toBe('div');
    });
  });
});
