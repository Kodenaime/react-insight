import { describe, it, expect, vi } from 'vitest';
import { installOrWrapHook } from '../src/fiber/hookShim';
import type { HookCallbacks } from '../src/fiber/hookShim';

/**
 * Unit tests for the hook shim's logic in isolation.
 *
 * These verify the shim's two code paths (fresh stub creation and
 * existing-hook wrapping) without involving a real React runtime.
 * The timing/load-order property is tested separately in
 * hookShim.realMount.test.ts.
 */

function makeWindow(): Window & typeof globalThis {
  return { __REACT_DEVTOOLS_GLOBAL_HOOK__: undefined } as unknown as Window & typeof globalThis;
}

const noopCallbacks: HookCallbacks = {
  onCommitFiberRoot: () => {},
};

describe('installOrWrapHook — fresh stub', () => {
  it('creates a hook stub when none exists', () => {
    const w = makeWindow();
    const hook = installOrWrapHook(w, noopCallbacks);

    expect(w.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeDefined();
    expect(hook.isDisabled).toBe(false);
    expect(hook.supportsFiber).toBe(true);
    expect(typeof hook.inject).toBe('function');
    expect(typeof hook.onScheduleFiberRoot).toBe('function');
    expect(typeof hook.onCommitFiberRoot).toBe('function');
    expect(typeof hook.onCommitFiberUnmount).toBe('function');
  });

  it('calls the injected onCommitFiberRoot callback when hook is fired', () => {
    const w = makeWindow();
    const spy = vi.fn();
    installOrWrapHook(w, { onCommitFiberRoot: spy });

    const fakeRoot = { current: { tag: 3 } };
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberRoot(1, fakeRoot);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(1, fakeRoot);
  });

  it('accepts unknown extra properties on the hook object', () => {
    const w = makeWindow();
    const hook = installOrWrapHook(w, noopCallbacks);

    // The hook should be extensible — React DevTools may add fields
    (hook as Record<string, unknown>).extraField = 'hello';
    expect((hook as Record<string, unknown>).extraField).toBe('hello');
  });

  it('stores the injected renderer via inject()', () => {
    const w = makeWindow();
    installOrWrapHook(w, noopCallbacks);

    const fakeRenderer = { name: 'ReactRenderer' };
    const result = w.__REACT_DEVTOOLS_GLOBAL_HOOK__!.inject(fakeRenderer);

    expect(result).toBe(fakeRenderer);
  });
});

describe('installOrWrapHook — error isolation', () => {
  it('does not throw when the injected callback throws', () => {
    const w = makeWindow();
    const throwing: HookCallbacks = {
      onCommitFiberRoot() {
        throw new Error('intentional failure');
      },
    };

    installOrWrapHook(w, throwing);

    // Must not propagate the error to the caller
    expect(() => {
      w.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberRoot(1, { current: null });
    }).not.toThrow();
  });
});

describe('installOrWrapHook — wrapping existing hook', () => {
  it('preserves the existing hook object when wrapping', () => {
    const w = makeWindow();
    const existing = {
      isDisabled: false,
      supportsFiber: true,
      inject: vi.fn(() => 'existing'),
      onScheduleFiberRoot: vi.fn(),
      onCommitFiberRoot: vi.fn(),
      onCommitFiberUnmount: vi.fn(),
      extraMethod: vi.fn(() => 'extra'),
    };
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = existing as unknown as typeof w.__REACT_DEVTOOLS_GLOBAL_HOOK__;

    const insightSpy = vi.fn();
    installOrWrapHook(w, { onCommitFiberRoot: insightSpy });

    expect(w.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeDefined();

    // The shim should call the existing hook's methods when the wrapped hook is invoked
    const fakeRoot = { current: { tag: 3 } };
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__!.onCommitFiberRoot(1, fakeRoot, 0);

    expect(existing.onCommitFiberRoot).toHaveBeenCalledWith(1, fakeRoot, 0);
    expect(insightSpy).toHaveBeenCalledWith(1, fakeRoot);
  });

  it('preserves existing hook return values from inject()', () => {
    const w = makeWindow();
    const existing = {
      isDisabled: false,
      supportsFiber: true,
      inject: vi.fn(() => 'original-return'),
      onScheduleFiberRoot: vi.fn(),
      onCommitFiberRoot: vi.fn(),
      onCommitFiberUnmount: vi.fn(),
    };
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = existing as unknown as typeof w.__REACT_DEVTOOLS_GLOBAL_HOOK__;

    installOrWrapHook(w, noopCallbacks);

    const result = w.__REACT_DEVTOOLS_GLOBAL_HOOK__!.inject('renderer');
    expect(existing.inject).toHaveBeenCalledWith('renderer');
    expect(result).toBe('original-return');
  });

  it('copies additional properties from the existing hook onto the wrapper', () => {
    const w = makeWindow();
    const existing = {
      isDisabled: false,
      supportsFiber: true,
      inject: () => {},
      onScheduleFiberRoot: () => {},
      onCommitFiberRoot: () => {},
      onCommitFiberUnmount: () => {},
      checkDCE: vi.fn(),
      rendererInterfaces: new Map(),
    };
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = existing as unknown as typeof w.__REACT_DEVTOOLS_GLOBAL_HOOK__;

    installOrWrapHook(w, noopCallbacks);

    expect((w.__REACT_DEVTOOLS_GLOBAL_HOOK__ as any).checkDCE).toBeDefined();
    expect((w.__REACT_DEVTOOLS_GLOBAL_HOOK__ as any).rendererInterfaces).toBeInstanceOf(Map);
  });
});

describe('installOrWrapHook — type and interface', () => {
  it('returns a DevToolsHook', () => {
    const w = makeWindow();
    const hook = installOrWrapHook(w, noopCallbacks);

    expect(hook.isDisabled).toBe(false);
    expect(typeof hook.onCommitFiberRoot).toBe('function');
  });
});
