# Twitter Thread: React Insight — Prompts 4 & 5

## Suggested Diagram (for image generation model)

**Prompt for DALL·E / Midjourney / Ideogram:**

> A split-diagram technical illustration. Left side: "React Double Buffering Problem" — two overlapping tree structures labeled "current (Fiber)" and "work-in-progress (Fiber)" with a red X over a WeakMap labeled "Keyed by Fiber reference ✗". Right side: "Our Solution" — a single component instance with a stable ID badge "MyComponent|key-1|0.0.2" connected to a history buffer and a FinalizationRegistry cleanup token. Below: a React StrictMode probe showing 1 commit vs 3 effect events, labeled "Empirical finding: effect-level only". Style: clean developer-tool aesthetic, dark background with green/amber accents.

## Thread

**Tweet 1**
One of the hardest problems in building a React devtool is that the objects React gives you to track components… don't actually stay the same.

React double-buffers Fiber nodes between "current" and "work-in-progress" trees. The same component instance gets a *different* Fiber object every render.

Keying history by Fiber reference = silent data loss and memory leaks. We needed a stable identity model that survives React's internal bookkeeping.

So we built one — and the fix taught us something unexpected about StrictMode 🧵

**Tweet 2**
The solution: synthetic instance IDs derived from tree position + component type + `key` prop.

`MyComponent||0.0.2`
`ExpenseRow|row-42|0.0.2.1`

This ID is stable across renders because the tree path doesn't change even when the Fiber object reference does. Two different Fibers for the same component → same ID → same history slot.

**Tweet 3**
Cleanup was a two-tier design:

1. **Explicit** (primary): called synchronously when `onCommitFiberUnmount` fires. Immediate, deterministic, testable. We verified 1,000 mount/unmount cycles → history store returns to 0 instantly. This is what gates CI.

2. **FinalizationRegistry** (backstop): fires when GC reclaims the registration token. Covers abrupt unmounts the explicit path misses. Timing is NOT guaranteed by spec — so we never assert on it in CI.

**Tweet 4**
Then came Prompt 5: the Render Reason Inspector.

Classify why every component re-rendered:
- STATE_CHANGE → memoizedState differed
- PROP_VALUE_CHANGE → props changed structurally
- PROP_REFERENCE_CHANGE → new object, same values
- UNMEMOIZED_CALLBACK → inline arrow function recreated
- PARENT_RENDER → nothing changed, parent just re-rendered
- CONTEXT_MUTATION → context value changed

**Tweet 5**
But first we had to answer a critical question about StrictMode.

The spec said "filter out StrictMode double-invocation so wasted render counts aren't inflated." Everyone *assumes* StrictMode produces duplicate observable renders. But nobody had actually measured it at the instrumentation layer.

So we built a probe. Mounted a real React 18 (and 19) component under `<StrictMode>`, instrumented `onCommitFiberRoot` and `useEffect`, and recorded exactly what happens.

**Tweet 6**
The finding surprised us:

**Commits: 1 call.** StrictMode does NOT produce duplicate `onCommitFiberRoot` calls. The double-invocation of component bodies happens *during* render and is discarded before commit. It never surfaces at the hook level.

**Effects: 3 events.** mount → cleanup → remount. The double-invocation IS observable, but only at the effect execution level.

This means: no StrictMode filter needed in the render inspector at all. The correction belongs in the Effect Analyzer (Phase 2.3).

**Tweet 7**
The biggest lesson: don't assume you know how React internals behave. The prior design doc assumed StrictMode double-invocation was a duplicate commit problem. We built a probe, ran it, and discovered the assumption was wrong. That saved us from implementing a filter that would have silently done nothing — and would have masked the *actual* mechanism.

Measure first. Code second.

**Tweet 8**
Current state of the codebase:
- 78 tests across 9 test files, all passing
- Hook shim that coexists with real React DevTools
- Stable instance identity (no Fiber-reference fragility)
- Render reason classification wired into the commit pipeline
- StrictMode behavior empirically documented in `FINDINGS.md`

Next up: the Effect Analyzer, ecosystem adapters (Zustand, TanStack Query), and the two-pass masking pipeline.

**Tweet 9 (optional — if you share the diagram)**
[Attach diagram]

The architecture so far: Hook Shim → Version Adapters → Instance Tracker + Diff Engine → Render Inspector → (next: UI Overlay). Every layer is grounded in empirical data from real React runtimes, not invented mock shapes.

If you're building tools on React internals: build your probes first. The Fiber tree will surprise you.

---

## Suggested Alt Text for Diagram

"Split diagram of React Insight architecture. Left side shows React's unstable Fiber double buffering problem with a red X. Right side shows the solution: synthetic instance IDs with FinalizationRegistry cleanup. Below: bar chart showing 1 commit vs 3 effect events under StrictMode, confirming the finding is effect-level only."
