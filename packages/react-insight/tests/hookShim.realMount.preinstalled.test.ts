/**
 * Real-mount integration test — pre-installed hook (DevTools extension present).
 *
 * Simulates the scenario where the official React DevTools browser extension
 * has already installed its hook on window/globalThis. The shim must detect
 * and wrap the existing hook, forward calls to it, AND fire its own callbacks
 * — both must fire on the same real React commit.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { installOrWrapHook, _removeHook } from '../src/fiber/hookShim';
import type { HookCallbacks } from '../src/fiber/hookShim';

interface SavedGlobals {
  window: typeof globalThis.window | undefined;
  document: typeof globalThis.document | undefined;
  self: typeof globalThis.self | undefined;
  navigator: typeof globalThis.navigator | undefined;
  requestAnimationFrame: typeof globalThis.requestAnimationFrame | undefined;
  cancelAnimationFrame: typeof globalThis.cancelAnimationFrame | undefined;
  MutationObserver: typeof globalThis.MutationObserver | undefined;
  Node: typeof globalThis.Node | undefined;
  Element: typeof globalThis.Element | undefined;
  HTMLElement: typeof globalThis.HTMLElement | undefined;
  Text: typeof globalThis.Text | undefined;
  EventTarget: typeof globalThis.EventTarget | undefined;
  NodeFilter: typeof globalThis.NodeFilter | undefined;
  setImmediate: typeof globalThis.setImmediate | undefined;
  setTimeout: typeof globalThis.setTimeout | undefined;
  clearTimeout: typeof globalThis.clearTimeout | undefined;
}

const _originalSetTimeout = setTimeout;
const _originalClearTimeout = clearTimeout;
const pendingTimers: ReturnType<typeof _originalSetTimeout>[] = [];

function flushPendingTimers() {
  for (const id of pendingTimers.splice(0)) _originalClearTimeout(id);
}

function setupEnv(): { win: Window; clean: () => void } {
  const win = new Window();
  win.document.write('<!DOCTYPE html><html><body><div id="root"></div></body></html>');

  (win as any).___hook___ = undefined;
  Object.defineProperty(win, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
    get: () => (win as any).___hook___,
    set: (v: unknown) => { (win as any).___hook___ = v; },
    configurable: true, enumerable: true,
  });

  const saved: SavedGlobals = {
    window: (globalThis as any).window, document: (globalThis as any).document,
    self: (globalThis as any).self, navigator: (globalThis as any).navigator,
    requestAnimationFrame: (globalThis as any).requestAnimationFrame,
    cancelAnimationFrame: (globalThis as any).cancelAnimationFrame,
    MutationObserver: (globalThis as any).MutationObserver,
    Node: (globalThis as any).Node, Element: (globalThis as any).Element,
    HTMLElement: (globalThis as any).HTMLElement, Text: (globalThis as any).Text,
    EventTarget: (globalThis as any).EventTarget,
    NodeFilter: (globalThis as any).NodeFilter,
    setImmediate: (globalThis as any).setImmediate,
    setTimeout: (globalThis as any).setTimeout,
    clearTimeout: (globalThis as any).clearTimeout,
  };

  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  try { (globalThis as any).self = win; } catch {
    Object.defineProperty(globalThis, 'self', { get: () => win, configurable: true });
  }
  Object.defineProperty(globalThis, 'navigator', { get: () => win.navigator, configurable: true });
  (globalThis as any).requestAnimationFrame = (fn: () => void) => setTimeout(fn, 16);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
  (globalThis as any).MutationObserver = win.MutationObserver;
  (globalThis as any).Node = win.Node; (globalThis as any).Element = win.Element;
  (globalThis as any).HTMLElement = win.HTMLElement; (globalThis as any).Text = win.Text;
  (globalThis as any).EventTarget = win.EventTarget; (globalThis as any).NodeFilter = win.NodeFilter;
  (globalThis as any).setImmediate = (fn: (...args: any[]) => void, ...args: any[]) => {
    const id = _originalSetTimeout(fn, 0, ...args);
    pendingTimers.push(id);
    return id;
  };

  const clean = () => {
    flushPendingTimers(); _removeHook();
    (globalThis as any).window = saved.window; (globalThis as any).document = saved.document;
    try { (globalThis as any).self = saved.self; } catch { /* noop */ }
    Object.defineProperty(globalThis, 'navigator', { get: () => saved.navigator, configurable: true });
    (globalThis as any).requestAnimationFrame = saved.requestAnimationFrame;
    (globalThis as any).cancelAnimationFrame = saved.cancelAnimationFrame;
    (globalThis as any).MutationObserver = saved.MutationObserver;
    (globalThis as any).Node = saved.Node; (globalThis as any).Element = saved.Element;
    (globalThis as any).HTMLElement = saved.HTMLElement; (globalThis as any).Text = saved.Text;
    (globalThis as any).EventTarget = saved.EventTarget; (globalThis as any).NodeFilter = saved.NodeFilter;
    if (saved.setImmediate === undefined) delete (globalThis as any).setImmediate;
    else (globalThis as any).setImmediate = saved.setImmediate;
    (globalThis as any).setTimeout = saved.setTimeout; (globalThis as any).clearTimeout = saved.clearTimeout;
  };
  return { win, clean };
}

function isRealFiberRoot(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.current === 'object' && obj.current !== null &&
    typeof (obj.current as Record<string, unknown>).tag === 'number';
}

describe('hookShim real-mount — pre-installed extension hook', () => {
  let clean: () => void;
  const prevEnv = process.env.NODE_ENV;

  afterEach(() => { clean?.(); vi.restoreAllMocks(); process.env.NODE_ENV = prevEnv; });

  it('fires both extension and Insight callbacks on the same commit', async () => {
    process.env.NODE_ENV = 'development';
    const { win, clean: c } = setupEnv(); clean = c;

    // Pre-install a DevTools-extension-like hook on globalThis and window
    const extensionSpy = vi.fn();
    const existingHook = {
      isDisabled: false,
      supportsFiber: true,
      inject: (r: unknown) => r,
      onScheduleFiberRoot: () => {},
      onCommitFiberRoot: (...args: unknown[]) => { extensionSpy(...args); },
      onCommitFiberUnmount: () => {},
      extraField: 'devtools-data',
    };
    (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = existingHook;
    (win as any).___hook___ = existingHook;

    // Wrap with Insight shim
    const insightSpy = vi.fn();
    installOrWrapHook(win as unknown as Window & typeof globalThis, {
      onCommitFiberRoot: insightSpy,
    } satisfies HookCallbacks);

    vi.resetModules();
    const React = await import('react');
    const ReactDOM = await import('react-dom/client');
    const ReactDOMMain = await import('react-dom');

    const h = React.createElement;
    function Test() { return h('div', null, 'coexistence'); }
    const container = win.document.getElementById('root')!;
    const root = ReactDOM.createRoot(container);
    ReactDOMMain.flushSync(() => { root.render(h(Test)); });

    expect(insightSpy).toHaveBeenCalled();
    expect(extensionSpy).toHaveBeenCalled();

    const [, insightRoot] = insightSpy.mock.calls[0] as [number, unknown];
    const [, extensionRoot] = extensionSpy.mock.calls[0] as [number, unknown];
    expect(insightRoot).toBe(extensionRoot);
    expect(isRealFiberRoot(insightRoot)).toBe(true);
  });
});
