# React Insight — Development Retrospective

## Part 1: The Hardest Challenges

### Challenge 1: Fiber Identity Instability

React double-buffers Fiber nodes between "current" and "work-in-progress" trees
across renders. The Fiber object reference for a single component instance
changes every render. Keying historical prop/state buffers by Fiber reference
caused silent data misattribution and memory leaks.

**Fix:** Replaced WeakMap<Fiber, history> with stable synthetic instance IDs
derived from tree position + component type + `key` prop. Built `instanceTracker.ts`
with `FinalizationRegistry` backstop + explicit synchronous cleanup via
`onCommitFiberUnmount`. Proved with 1,000 mount/unmount cycles clearing the
store to 0 deterministically.

### Challenge 2: The Tech Spec Was Wrong About StrictMode

The spec assumed StrictMode double-invocation produces duplicate
`onCommitFiberRoot` calls — meaning we'd need a filter at the render-counting
layer. We built empirical probes against real React 18 and 19 installs and
discovered the assumption was wrong: `onCommitFiberRoot` fires ONCE per mount
under StrictMode. The double-invocation only manifests at the `useEffect`
execution level (mount → cleanup → remount, 3 events).

**Fix:** No filter needed in the render inspector. The
`STRICT_MODE_DOUBLE_INVOCATION` classification was added to the Effect Analyzer
(Phase 2.3) instead. Documented in `FINDINGS.md`. This saved us from
implementing a filter that would have silently done nothing — and would have
masked the actual mechanism.

### Challenge 3: Real-Mount Integration Tests

Writing tests that actually prove the load-order constraint works (hook shim
runs before react-dom imports) required a completely different approach than
mock-based unit tests. The shim must install on `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`
before React's reconciler initializes — a timing property, not a logic property.

**Fix:** Two-tier testing strategy:
- Unit tests (`hookShim.unit.test.ts`) — verify shim logic in isolation
- Real-mount tests (`hookShim.realMount.*.test.ts`) — install shim FIRST,
  dynamically import react-dom SECOND, mount a real component, and assert the
  callback receives a real FiberRootNode from an actual React commit.
  These tests fail if someone reduces the shim to only work when manually invoked.

### Challenge 4: Zustand Has Two Distinct APIs

The spec conflated Zustand's React Hook API (`create()` returns a hook:
`useStore(selector?)`) with its Vanilla API (`createStore()` returns
`{ getState, setState, subscribe }`). Patching `.subscribe()` would detect
vanilla-only patterns that don't correlate with component re-renders.

**Fix:** Refactored the adapter to instrument the HOOK function itself — wrapping
`create()` so every returned hook inspects selector arguments. No selector (or
identity selector `s => s`) emits a full-subscription warning. A specific selector
like `state => state.count` produces no warning. Documented the distinction
prominently in the code.

### Challenge 5: Launch-Editor Is Real Local Attack Surface

A local HTTP endpoint that opens arbitrary files in a developer's IDE is a
genuine security risk: DNS rebinding, cross-origin POST from malicious pages,
path traversal.

**Fix:** Four mandatory security constraints:
1. Bind to 127.0.0.1 only (never 0.0.0.0)
2. Per-session 32-byte random token (64-char hex), required on every request
3. Path traversal guard — `resolveSafePath()` normalizes and rejects escape attempts
4. Origin header validation — cross-origin requests rejected with 403

All documented in `SECURITY.md` with a threat model table.

### Challenge 6: StrictMode Probe Required Fiber Fixtures First

To build the StrictMode probe, we first needed ground-truth Fiber tree snapshots
from real React installs — not invented mock shapes. This meant building three
self-contained sub-projects each installing a different React major version
(17.0.2, 18.3.1, 19.2.7), with a cycle-safe serializer that strips circular
references and preserves hook linked-list shapes.

**Fix:** `scripts/fixture-capture/` with three harnesses + shared serializer.
Generated `fixtures/fiber/r17.json`, `r18.json`, `r19.json`. The diff analysis
(`DIFFERENCES.md`) revealed that hook linked-list shapes are IDENTICAL across
all three versions — one hook parser works for all, which was a critical
architectural discovery.

### Challenge 7: GC Timing Cannot Gate CI

`FinalizationRegistry` callback timing is NOT guaranteed by the ECMAScript spec.
Even after forced `gc()`, callbacks may run late or not at all within a test
lifetime. A test that hard-asserts "map size is 0 after gc()" is inherently
flaky.

**Fix:** Two-tier cleanup testing:
- **Deterministic** (gates CI): `trackInstanceCleanup()` called explicitly —
  1,000 mount/unmount cycles, store returns to 0 immediately. 11 tests.
- **Informational** (non-blocking): GC smoke test with `--expose-gc`, polls
  for up to 5 seconds, logs results but never fails. Run via `pnpm test:gc-smoke`.

---

## Part 2: The Main Arms of React Insight

### ReactInsightEngine (Core Pipeline)

The central orchestrator. Hooked into `window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`,
it walks the committed Fiber tree on every render. Pipeline:
`trackInstance() → classifyRender() → analyzeEffects() → computeHealthScore()`
Each component's history is updated with render reason, wasted flag, and effect
analysis. Exposes `getHealthScore()`, `getAdapterWarnings()`, and lifecycle
methods. 150+ tests.

### Hook Shim (`fiber/hookShim.ts`)

Unconditionally installs or wraps the DevTools global hook before react-dom
initializes. Supports fresh stub creation (no DevTools extension present) and
existing-hook wrapping (real React DevTools extension active — both coexist).
Every callback is wrapped in try/catch per the Instrumentation Guard (spec §6.1).
Coexistence tested with real React 19 mounts.

### Instance Tracker (`engine/instanceTracker.ts`)

Synthetic instance identity — solves the Fiber double-buffering problem. Each
component gets a stable ID: `ComponentName|key|tree.path`. History store is
`Map<string, ComponentHistory>`. Cleanup is two-tier: explicit
(`onCommitFiberUnmount`) + FinalizationRegistry backstop. Render counts are
accurate even under StrictMode (confirmed by probe).

### Diff Engine (`engine/diffEngine.ts`)

Two-tier comparison. Fast path: O(1) `prev === next`. Deep path: bounded
structural diff (depth=4, keys=50) with WeakSet cycle guard. Returns structured
`DiffResult` with changed paths and human-readable reasons. Bounded-claim
messaging — appends "(comparison truncated at configured limits)" when limits
are hit. 38 tests covering primitives, nested objects, arrays, circular refs,
and truncation.

### Render Inspector (`engine/renderInspector.ts`)

Classifies every component render into 7 reasons: MOUNT, STATE_CHANGE,
PROP_VALUE_CHANGE, PROP_REFERENCE_CHANGE, UNMEMOIZED_CALLBACK,
CONTEXT_MUTATION, PARENT_RENDER. Uses previous-snapshot store to diff props
and state across commits. Feeds into the health engine's inline allocation
and wasted render metrics.

### Effect Analyzer (`engine/effectAnalyzer.ts`)

Reads effect hooks from the Fiber's hook linked list. Classifies: FIRST_MOUNT,
RE_RAN (with exact changed dependency index), UNBOUNDED (no deps array),
STRICT_MODE_DOUBLE_INVOCATION (mount→cleanup→remount pattern detected),
OFFSCREEN_REAPPEARANCE (React 19 Activity boundary). Human-readable causes
like "deps[2] value changed (onClick → onClick)". 17 tests.

### Health Engine (`engine/healthEngine.ts`)

Computes a 0–100 score from 5 sub-metrics: wasted renders (cap 30), prop
depth (cap 20), inline allocations (cap 20), context fanout (cap 15), effect
churn (cap 15). Each metric has configurable weights. Generates prioritized
actionable recommendations with severity levels (critical/warning/info).
19 tests.

### Context Analyzer (`engine/contextAnalyzer.ts`)

Tracks Context Provider value changes and counts fan-out consumers per update.
Walks the Fiber tree for tag-10 (Provider) and tag-9 (Consumer) fibers. Feeds
into the health engine's context_fanout_penalty metric.

### Security Masker (`security/masker.ts`)

Two-pass recursive redaction pipeline. Pass 1: key-name regex matching
(`/token|password|secret|auth|creditCard|ssn|apiKey/i`). Pass 2: value-shape
detection (JWT, Luhn-checkable credit cards, Bearer token prefixes). Depth
limit 4, key limit 50, WeakSet cycle guard. Non-destructive — creates new
object tree. 29 tests.

### Ecosystem Adapters (`adapters/`)

Three adapters following the spec §4 principle (instrument the library, not
the Fiber tree):

- **ZustandAdapter:** Wraps `create()` to inspect hook selector usage.
  Detects full-store subscriptions (no selector) and emits recommendations.
  Uses `patchZustandModule()` for ESM test environments.

- **TanStackQueryAdapter:** Patches `QueryClient.prototype.getQueryCache` to
  instrument cache subscribe. Detects redundant queries and excessive refetches.

- **StateAdapter interface:** Standard attach/detach lifecycle.

### UI Overlay (`ui/OverlayDrawer.tsx`)

Dark-mode dockable overlay rendered via React Portal. Four-tab interface:
Overview (health score + metrics), Inspector (per-component breakdown),
Effects (effect timeline), Fixes (code diff suggestions), Graph (component
visualizer). Polls engine telemetry every 2s. Wrap in ErrorBoundary.

### UI Views (`ui/views/`)

- **RenderInspectorView:** Component list with summary stats, color-coded
  reason badges, click-to-expand detail panel with props and effects.
- **EffectTimelineView:** Flat timeline of all effect executions with
  status badges, changed dependency display, human-readable causes.
- **CodeDiffView:** Auto-generates `useCallback`/`useMemo` refactoring
  suggestions from detected UNMEMOIZED_CALLBACK and PROP_REFERENCE_CHANGE
  patterns. Copy-to-clipboard for each fix.
- **GraphView:** Dual-mode component relationship visualizer — Full Canvas
  (all components as node cards, capped at 500) and Active Path (ancestor
  chain for selected component).

### Launch Editor (`packages/launch-editor/`)

Secured dev-server companion for IDE "Jump to Code" navigation. Four mandatory
security constraints: loopback-only bind, per-session token, path traversal
guard, origin validation. Vite plugin injects token as `<meta>` tag. Webpack
and Next.js stubs for future implementation. Full `SECURITY.md` with threat
model.

### Error Boundary (`ui/ErrorBoundary.tsx`)

Per spec §6.1, two independent failure surfaces:
- **UI Boundary:** ErrorBoundary wrapping the overlay — catches render-phase
  crashes, unmounts only the overlay, logs single `console.warn`, never
  affects the host app.
- **Instrumentation Guard:** try/catch in hookShim.ts — catches commit-phase
  interceptor errors outside any component tree.

### Production Shell (`production.tsx`)

When `process.env.NODE_ENV === 'production'`, the entire devtool resolves to a
308-byte noop that renders `{children}` with zero hooks, zero observers, zero
side effects. Dead-code eliminated by Terser. Verified by test.
