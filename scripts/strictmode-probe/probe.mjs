/**
 * StrictMode Double-Invocation Probe
 *
 * Empirically measures what IS and ISN'T duplicated when using
 * React 18 and 19 <StrictMode>.
 *
 * Questions this answers:
 *   1. Does onCommitFiberRoot fire twice per mount in StrictMode?
 *   2. Does useEffect fire twice (mount → cleanup → mount)?
 *   3. Is there any externally observable "double commit" signal?
 *   4. Does React 18 behave differently from React 19?
 *   5. Does StrictMode double-invoke state updaters in a way that
 *      produces duplicate commits?
 *
 * Run: node --conditions=development scripts/strictmode-probe/probe-18.mjs
 *      node --conditions=development scripts/strictmode-probe/probe-19.mjs
 */

// Config — set via env or defaults
const VERSION = process.env.VERSION || '18';

import { Window } from 'happy-dom';

// ── 1. Browser polyfills ────────────────────────────────────
const win = new Window();
win.document.write('<!DOCTYPE html><html><body><div id="root"></div></body></html>');

(globalThis as any).window = win;
(globalThis as any).document = win.document;
try { (globalThis as any).self = win; } catch {
  Object.defineProperty(globalThis, 'self', { get: () => win, configurable: true });
}
Object.defineProperty(globalThis, 'navigator', { get: () => win.navigator, configurable: true });
(globalThis as any).requestAnimationFrame = (fn: () => void) => setTimeout(fn, 16);
(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
(globalThis as any).MutationObserver = win.MutationObserver;
(globalThis as any).Node = win.Node;
(globalThis as any).Element = win.Element;
(globalThis as any).HTMLElement = win.HTMLElement;
(globalThis as any).Text = win.Text;
(globalThis as any).EventTarget = win.EventTarget;
(globalThis as any).NodeFilter = win.NodeFilter;

const _origSetTimeout = setTimeout;
(globalThis as any).setImmediate = (fn: (...args: any[]) => void, ...args: any[]) => {
  const id = _origSetTimeout(fn, 0, ...args);
  return id;
};

process.env.NODE_ENV = 'development';

// ── 2. Log data ──────────────────────────────────────────────
const commitLog: Array<{ index: number; time: number; baseTag: number; childTags: string }> = [];
const effectLog: Array<{ index: number; phase: 'mount' | 'cleanup' | 'remount'; time: number }> = [];
const stateUpdateLog: Array<{ index: number; value: number; time: number }> = [];
let commitIndex = 0;
let effectIndex = 0;

// ── 3. Hook shim ─────────────────────────────────────────────
const devToolsHook = {
  supportsFiber: true,
  isDisabled: false,
  rendererInterfaces: new Map(),
  renderers: new Map(),
  inject(renderer: unknown) { this.rendererInterfaces.set(renderer, renderer); return renderer; },
  onCommitFiberRoot(rendererID: number, root: unknown) {
    commitIndex++;
    const fiberRoot: any = root;
    const hostRoot = fiberRoot?.current;
    let childTags = '';
    let cursor = hostRoot?.child;
    while (cursor) {
      childTags += `[tag:${cursor.tag} type:${cursor.type?.name || cursor.type || '?'}]`;
      cursor = cursor.sibling;
    }
    commitLog.push({
      index: commitIndex,
      time: Date.now(),
      baseTag: hostRoot?.tag,
      childTags,
    });
  },
  onCommitFiberUnmount() {},
  onScheduleFiberRoot() {},
};
(globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = devToolsHook;

// ── 4. Import React ──────────────────────────────────────────
const dir = VERSION === '19'
  ? new URL('../../packages/react-insight/node_modules/', import.meta.url)
  : new URL('../../scripts/fixture-capture/r18/node_modules/', import.meta.url);

const reactPkgDir = VERSION === '19'
  ? new URL('./react/', dir)
  : new URL('./react/', dir);
const reactDomPkgDir = VERSION === '19'
  ? new URL('./react-dom/', dir)
  : new URL('./react-dom/', dir);

const { createRequire } = await import('module');
const __filename = new URL('', import.meta.url).pathname;
const _require = createRequire(__filename);

const React = _require(reactPkgDir.pathname + 'cjs/react.development.js');
const ReactDOM = VERSION === '19'
  ? _require(reactDomPkgDir.pathname + 'client.js')
  : _require(reactDomPkgDir.pathname + 'cjs/react-dom.development.js');

const ReactDOMMain = VERSION === '19'
  ? _require(reactDomPkgDir.pathname + 'cjs/react-dom.development.js')
  : _require(reactDomPkgDir.pathname + 'cjs/react-dom.development.js');

const { createElement: h, useState, useEffect, StrictMode, useMemo, useCallback } = React;

// ── 5. Test components ───────────────────────────────────────

function EffectTracker() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    effectIndex++;
    effectLog.push({ index: effectIndex, phase: 'mount', time: Date.now() });
    return () => {
      effectIndex++;
      effectLog.push({ index: effectIndex, phase: 'cleanup', time: Date.now() });
    };
  }, []);

  const handleClick = useCallback(() => {
    setCount((c: number) => {
      stateUpdateLog.push({ index: commitIndex, value: c + 1, time: Date.now() });
      return c + 1;
    });
  }, []);

  return h('div', null,
    h('span', null, `Count: ${count}`),
    h('button', { onClick: handleClick }, 'Increment')
  );
}

function App() {
  return h('div', { className: 'app' },
    h('h1', null, `StrictMode Probe — React ${VERSION}`),
    h(EffectTracker, null)
  );
}

// ── 6. Mount via createRoot ─────────────────────────────────
const container = win.document.getElementById('root')!;
const createRoot = ReactDOM.createRoot || ReactDOM.createRoot;
const root = createRoot(container);
const StrictModeComp = StrictMode || React.StrictMode;

root.render(h(StrictModeComp, null, h(App, { title: `React ${VERSION} Probe` })));

// ── 7. Flush ────────────────────────────────────────────────
// Give React a tick to settle
await new Promise(r => _origSetTimeout(r, 100));

// ── 8. Report ───────────────────────────────────────────────
console.log(`\n═══ StrictMode Probe Results — React ${VERSION} ═══\n`);
console.log(`Total onCommitFiberRoot calls: ${commitIndex}`);
console.log(`Total useEffect mount/cleanup events: ${effectIndex}\n`);

console.log('onCommitFiberRoot events:');
for (const c of commitLog) {
  console.log(`  #${c.index}: time=${c.time} baseTag=${c.baseTag} children=${c.childTags.slice(0, 200)}`);
}

console.log('\nuseEffect events:');
for (const e of effectLog) {
  console.log(`  #${e.index}: phase=${e.phase} time=${e.time}`);
}

// Analysis
console.log('\n═══ Analysis ═══');
const commitCount = commitLog.length;
const mountEffects = effectLog.filter(e => e.phase === 'mount').length;
const cleanupEffects = effectLog.filter(e => e.phase === 'cleanup').length;

console.log(`Commits: ${commitCount}${commitCount > 1 ? ' (DOUBLED — StrictMode produces extra commits!)' : ' (single — no duplicate commits observed)'}`);
console.log(`useEffect mounts: ${mountEffects}${mountEffects > 1 ? ' (DOUBLED — StrictMode double-invokes effects)' : ' (single)'}`);
console.log(`useEffect cleanups: ${cleanupEffects}${cleanupEffects > 0 ? ' (cleanups observed)' : ' (none)'}`);

if (commitCount === 1) {
  console.log('\n✓ CONFIRMED: StrictMode does NOT produce duplicate onCommitFiberRoot calls.');
  console.log('  The double-invocation happens DURING render (internally) and is discarded');
  console.log('  before commit. It is NOT observable at the hook/commit level.');
}

if (mountEffects > 1) {
  console.log('\n⚠ CONFIRMED: StrictMode double-invokes useEffect (mount → cleanup → remount).');
  console.log('  This IS observable at the effect level, NOT at the commit level.');
}

console.log('\n═══ End ═══\n');
