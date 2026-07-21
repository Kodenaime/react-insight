/**
 * React 17 Fiber Tree Capture Harness
 *
 * Sets up a minimal DOM via happy-dom, installs a DevTools hook shim BEFORE
 * React loads, renders test components via ReactDOM.render(), then captures
 * the committed Fiber tree via the hook's onCommitFiberRoot callback.
 *
 * Run: node --conditions=development capture-r17.mjs
 */

import { Window } from 'happy-dom';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { writeFileSync, mkdirSync } from 'fs';

// ── 1. Polyfill minimal browser globals BEFORE React imports ──────────────
const win = new Window();
win.document.write('<!DOCTYPE html><html><body><div id="root"></div></body></html>');

globalThis.window = win;
globalThis.document = win.document;
try { globalThis.self = win; } catch {
  Object.defineProperty(globalThis, 'self', { get: () => win, configurable: true });
}
globalThis.Node = win.Node;
globalThis.Element = win.Element;
globalThis.HTMLElement = win.HTMLElement;
globalThis.Text = win.Text;
globalThis.EventTarget = win.EventTarget;
globalThis.NodeFilter = win.NodeFilter;
Object.defineProperty(globalThis, 'navigator', {
  get: () => win.navigator,
  configurable: true,
});
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.MutationObserver = win.MutationObserver;

// ── 2. Set DEV mode before React loads ────────────────────────────────────
process.env.NODE_ENV = 'development';

// ── 3. Install the DevTools hook shim BEFORE React loads ──────────────────
let capturedRootFiber = null;

const devToolsHook = {
  supportsFiber: true,
  isDisabled: false,
  rendererInterfaces: new Map(),
  renderers: new Map(),
  inject(renderer) {
    this.rendererInterfaces.set(renderer, renderer);
    return renderer;
  },
  onCommitFiberRoot(rendererId, root) {
    if (root && root.current) {
      capturedRootFiber = root.current;
    }
  },
  onCommitFiberUnmount() {},
  onScheduleFiberRoot() {},
};

// Set on globalThis, global, and window to cover all access patterns
globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = devToolsHook;
global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = devToolsHook;
if (typeof win.__REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined') {
  Object.defineProperty(win, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
    get: () => devToolsHook,
    configurable: true,
  });
}

// ── 4. Load React & react-dom as CJS (absolute paths for reliability) ──────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const { createRequire } = await import('module');
const _require = createRequire(__filename);

// Resolve the package root of react, then load the CJS dev bundle
const reactPkgDir = _require.resolve('react/package.json').replace(/package\.json$/, '');
const reactDomPkgDir = _require.resolve('react-dom/package.json').replace(/package\.json$/, '');

const React = _require(reactPkgDir + 'cjs/react.development.js');
const ReactDOM = _require(reactDomPkgDir + 'cjs/react-dom.development.js');

const { createElement: h, Component, createContext, useState, useEffect, useMemo, useContext } = React;

// ── 5. Define test components ──────────────────────────────────────────────

// Context
const ThemeContext = createContext({ theme: 'light' });

// Class component
class ClassCounter extends Component {
  constructor(props) {
    super(props);
    this.state = { count: 0, label: 'class' };
  }
  render() {
    return h('div', { className: 'class-counter' },
      h('span', null, `Count: ${this.state.count}`)
    );
  }
}

// Function component: useState
function FunctionCounter() {
  const [count, setCount] = useState(42);
  const [name] = useState('react-insight');
  return h('div', null,
    h('span', null, `Count: ${count}`),
    h('span', null, name)
  );
}

// Function component: useEffect + useMemo
function EffectLogger({ id }) {
  const [items] = useState([1, 2, 3]);
  const doubled = useMemo(() => items.map(x => x * 2), [items]);

  useEffect(() => {
    // side effect (no-op for capture)
  }, [id]);

  return h('div', null,
    h('span', null, `ID: ${id}`),
    h('span', null, `Doubled: ${doubled.join(',')}`)
  );
}

// Function component: useContext
function ThemeReader() {
  const ctx = useContext(ThemeContext);
  return h('span', { className: 'theme-display' }, ctx.theme);
}

// Simple host-only component
function SimpleDiv({ children }) {
  return h('div', { className: 'simple' }, children);
}

// Wrapper that nests everything
function App({ title }) {
  return h('div', { className: 'app' },
    h('h1', null, title),
    h(ClassCounter, { initial: 0 }),
    h(FunctionCounter, null),
    h(EffectLogger, { id: 'logger-1' }),
    h(ThemeContext.Provider, { value: { theme: 'dark' } },
      h(ThemeReader, null)
    ),
    h(SimpleDiv, null, 'hello world')
  );
}

// ── 6. Render ──────────────────────────────────────────────────────────────
const container = document.getElementById('root');
ReactDOM.render(h(App, { title: 'React 17 Fixture' }), container);

// ── 7. Serialize & write ───────────────────────────────────────────────────
const { serializeFiberTree } = await import(
  pathToFileURL(resolve(__dirname, '../shared/serializer.mjs'))
);

const tree = serializeFiberTree(capturedRootFiber);

const ReactPkg = _require(reactPkgDir + 'package.json');
const ReactDOMPkg = _require(reactDomPkgDir + 'package.json');

const output = {
  meta: {
    react: ReactPkg.version,
    reactDom: ReactDOMPkg.version,
    capturedAt: new Date().toISOString(),
    env: process.env.NODE_ENV,
    renderer: 'ReactDOM.render (legacy)',
    components: [
      'ClassCounter (class)',
      'FunctionCounter (useState x2)',
      'EffectLogger (useEffect + useMemo + useState)',
      'ThemeReader (useContext)',
      'SimpleDiv (host-only)',
    ],
  },
  fiberTree: tree,
};

const outDir = resolve(__dirname, '../../../fixtures/fiber');
mkdirSync(outDir, { recursive: true });
const jsonCircularGuard = new WeakSet();
writeFileSync(resolve(outDir, 'r17.json'), JSON.stringify(output, function(key, val) {
  if (typeof val === 'object' && val !== null) {
    if (jsonCircularGuard.has(val)) return '(circular)';
    jsonCircularGuard.add(val);
  }
  return val;
}, 2));

console.log(`✓ r17.json written — React ${ReactPkg.version}`);
process.exit(0);
