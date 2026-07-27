/**
 * StrictMode Double-Invocation Probe — React 19
 *
 * Run: node scripts/strictmode-probe/probe-19.mjs
 */

import { Window } from 'happy-dom';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const win = new Window();
win.document.write('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
globalThis.window = win;
globalThis.document = win.document;
try { globalThis.self = win; } catch {
  Object.defineProperty(globalThis, 'self', { get: () => win, configurable: true });
}
Object.defineProperty(globalThis, 'navigator', { get: () => win.navigator, configurable: true });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.MutationObserver = win.MutationObserver;
globalThis.Node = win.Node;
globalThis.Element = win.Element;
globalThis.HTMLElement = win.HTMLElement;
globalThis.Text = win.Text;
globalThis.EventTarget = win.EventTarget;
globalThis.NodeFilter = win.NodeFilter;
globalThis.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
process.env.NODE_ENV = 'development';

const commitLog = [];
const effectLog = [];
let ci = 0, ei = 0;

globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  supportsFiber: true, isDisabled: false,
  inject(r) { return r; },
  onCommitFiberRoot(rid, root) {
    ci++;
    const cur = root?.current;
    let types = '';
    let c = cur?.child;
    while (c) { types += `[t=${c.tag}]`; c = c.sibling; }
    commitLog.push({ index: ci, tag: cur?.tag, childTypes: types });
  },
  onCommitFiberUnmount() {},
  onScheduleFiberRoot() {},
};

const fixtureDir = resolve(__dirname, '../../scripts/fixture-capture/r19');
const { createRequire } = await import('module');
const _require = createRequire(__filename);

const reactRoot = resolve(fixtureDir, 'node_modules/react/');
const reactDomRoot = resolve(fixtureDir, 'node_modules/react-dom/');
const React = _require(reactRoot + '/cjs/react.development.js');
const ReactDOMClient = _require(reactDomRoot + '/client.js');
const ReactDOMMain = _require(reactDomRoot + '/cjs/react-dom.development.js');
const { createElement: h, useState, useEffect, StrictMode } = React;

function InnerEffect() {
  const [v] = useState('inner');
  useEffect(() => {
    ei++;
    effectLog.push({ index: ei, phase: 'mount' });
    return () => {
      ei++;
      effectLog.push({ index: ei, phase: 'cleanup' });
    };
  }, []);
  return h('span', null, v);
}

function App() {
  return h('div', null, h(InnerEffect, null));
}

const container = win.document.getElementById('root');
const root = ReactDOMClient.createRoot(container);
ReactDOMMain.flushSync(() => {
  root.render(h(StrictMode, null, h(App, null)));
});
for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 50));

console.log('\n═══ StrictMode Probe — React 19 ═══\n');
console.log('onCommitFiberRoot calls: ' + ci);
for (const c of commitLog) console.log('  #' + c.index + ': tag=' + c.tag + ' ' + c.childTypes);
console.log('\nuseEffect events: ' + ei);
for (const e of effectLog) console.log('  #' + e.index + ': ' + e.phase);

console.log('\n─── Findings ───');
if (ci === 1) console.log('✓ Commits: SINGLE');
else console.log('⚠ Commits: ' + ci);
if (ei >= 3) console.log('✓ Effects: DOUBLE INVOCATION confirmed (' + ei + ' events)');
else console.log('□ Effects: ' + ei + ' events');

process.exit(0);
