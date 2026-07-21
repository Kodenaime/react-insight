/**
 * React 19 Fiber Tree Capture Harness
 *
 * Uses createRoot() with StrictMode. Includes an Offscreen/Activity boundary
 * if available in the installed React 19 version.
 *
 * Run: node --conditions=development capture-r19.mjs
 */

import { Window } from 'happy-dom';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { writeFileSync, mkdirSync } from 'fs';

// ── 1. Polyfill browser globals BEFORE React imports ──────────────────────
const win = new Window();
win.document.write('<!DOCTYPE html><html><body><div id="root"></div></body></html>');

globalThis.window = win;
try { globalThis.self = win; } catch {
  Object.defineProperty(globalThis, 'self', { get: () => win, configurable: true });
}
globalThis.document = win.document;
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

// ── 2. DEV mode BEFORE React loads ────────────────────────────────────────
process.env.NODE_ENV = 'development';

// ── 3. Hook shim BEFORE React loads ────────────────────────────────────────
let capturedRootFiber = null;

const devToolsHook = {
  supportsFiber: true,
  isDisabled: false,
  rendererInterfaces: new Map(),
  renderers: new Map(),
  inject(renderer) {
    renderer.overrideHookState = (fiber, id, value) => {};
    renderer.overrideProps = (fiber, path, value) => {};
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
// React 19 moved createRoot to react-dom/client
const ReactDOMClient = _require(reactDomPkgDir + 'client.js');
const ReactDOM = _require(reactDomPkgDir + 'cjs/react-dom.development.js');

const {
  createElement: h, Component, createContext, Fragment,
  useState, useEffect, useMemo, useContext, StrictMode,
  unstable_Offscreen, // React 19 may expose Offscreen/Activity
} = React;

// ── 5. Test components ──────────────────────────────────────────────────────

const ThemeContext = createContext({ theme: 'light' });

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

function FunctionCounter() {
  const [count, setCount] = useState(77);
  const [name] = useState('react-19');
  return h('div', null,
    h('span', null, `Count: ${count}`),
    h('span', null, name)
  );
}

function EffectLogger({ id }) {
  const [items] = useState([100, 200, 300]);
  const doubled = useMemo(() => items.map(x => x * 2), [items]);

  useEffect(() => {
    // side effect — no-op for capture
  }, [id]);

  return h('div', null,
    h('span', null, `ID: ${id}`),
    h('span', null, `Doubled: ${doubled.join(',')}`)
  );
}

function ThemeReader() {
  const ctx = useContext(ThemeContext);
  return h('span', { className: 'theme-display' }, ctx.theme);
}

function SimpleDiv({ children }) {
  return h('div', { className: 'simple' }, children);
}

// Component hidden inside Offscreen boundary
function HiddenContent() {
  return h('div', { className: 'offscreen-content' },
    h('p', null, 'This is inside Offscreen')
  );
}

function App({ title }) {
  const children = [
    h('h1', { key: 'title' }, title),
    h(ClassCounter, { key: 'class-counter', initial: 0 }),
    h(FunctionCounter, { key: 'fn-counter' }),
    h(EffectLogger, { key: 'effect-logger', id: 'logger-1' }),
    h(ThemeContext.Provider, { key: 'theme-provider', value: { theme: 'dark' } },
      h(ThemeReader, { key: 'theme-reader' })
    ),
    h(SimpleDiv, { key: 'simple' }, 'hello world'),
  ];

  // Append Offscreen boundary if the API exists in this React 19 build
  if (unstable_Offscreen) {
    children.push(
      h(unstable_Offscreen, { key: 'offscreen', mode: 'hidden' },
        h(HiddenContent, null)
      )
    );
  }

  return h('div', { className: 'app' }, ...children);
}

// ── 6. Render via createRoot — wrapped in StrictMode ─────────────────────
const container = document.getElementById('root');
const root = ReactDOMClient.createRoot(container);
root.render(h(StrictMode, null, h(App, { title: 'React 19 Fixture' })));

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
    renderer: 'createRoot (concurrent)',
    strictMode: true,
    offscreenAvailable: !!unstable_Offscreen,
    components: [
      'ClassCounter (class)',
      'FunctionCounter (useState x2)',
      'EffectLogger (useEffect + useMemo + useState)',
      'ThemeReader (useContext)',
      'SimpleDiv (host-only)',
      'HiddenContent (inside Offscreen boundary, if available)',
    ],
  },
  fiberTree: tree,
};

const outDir = resolve(__dirname, '../../../fixtures/fiber');
mkdirSync(outDir, { recursive: true });
const jsonCircularGuard = new WeakSet();
writeFileSync(resolve(outDir, 'r19.json'), JSON.stringify(output, function(key, val) {
  if (typeof val === 'object' && val !== null) {
    if (jsonCircularGuard.has(val)) return '(circular)';
    jsonCircularGuard.add(val);
  }
  return val;
}, 2));

console.log(`✓ r19.json written — React ${ReactPkg.version}`);
process.exit(0);
