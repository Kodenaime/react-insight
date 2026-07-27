# StrictMode Double-Invocation — Empirical Findings

## Probe Methodology

Two standalone probe scripts (`probe-18.mjs` and `probe-19.mjs`) mount a real function component wrapped in `<StrictMode>`, using `flushSync` for synchronous rendering, and instrument:
- `window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` — counts committed renders
- `useEffect` mount/cleanup callbacks — counts effect executions

React versions tested: **18.3.1** and **19.2.7**.

## Results

### onCommitFiberRoot (commit-level)

| Version | Calls | Doubled? |
|---------|-------|----------|
| 18      | 1     | **No**   |
| 19      | 1     | **No**   |

**StrictMode does NOT produce duplicate `onCommitFiberRoot` calls.** The double-invocation of component bodies/state updater functions happens internally during the render phase and is discarded before commit. It never surfaces as a second commit.

### useEffect (effect-level)

| Version | Events (mount → cleanup → remount) | Doubled?       |
|---------|-------------------------------------|----------------|
| 18      | 3                                   | **Yes**        |
| 19      | 3                                   | **Yes**        |

**StrictMode DOES double-invoke `useEffect`** — the pattern is `mount → cleanup → remount` (3 events total for a single mount). This is the confirmed externally-observable signal of StrictMode double-invocation.

## Implication for React Insight

1. **Render counts are NOT inflated by StrictMode.** The `incrementRenderCount()` call in the commit walker produces accurate counts regardless of StrictMode. No filter is needed at the render-counting layer.

2. **Effect execution filtering IS needed.** When React Insight's effect analyzer (Phase 2.3) tracks `useEffect` execution reasons, it must filter out the StrictMode double-invocation pattern: the mount → cleanup → remount sequence that occurs during initial mount under StrictMode. This should be flagged as `STRICT_MODE_DOUBLE_INVOCATION` and excluded from "wasted render / wasted effect" metrics.

3. **The filter operates on effect execution history, not render commit history.** The `RenderReason` classification (`STATE_CHANGE`, `PROP_REFERENCE_CHANGE`, etc.) applies at the commit level and requires no StrictMode correction. The StrictMode correction applies at the *effect execution analysis* level, which will be implemented when the Effect Analyzer (Phase 2.3) is built.

## Known Limitation

React Insight cannot distinguish between a StrictMode double-invoked effect and a genuine mount → unmount → remount sequence at the commit level. Both produce identical Fiber tree shapes. The distinction is only visible at the effect execution level by analyzing the timing pattern (mount/cleanup/remount in rapid succession). This means:

- The **render reason inspector** (commit-level) needs no StrictMode filter.
- The **effect analyzer** (effect-level) needs a StrictMode filter that recognizes the 3-event pattern.
- Any tool that only instruments `onCommitFiberRoot` (not effect execution) **cannot** detect or filter StrictMode double-invocation — this is a fundamental limitation of the hook API.

## Files

- `probe-18.mjs` — React 18 probe script
- `probe-19.mjs` — React 19 probe script
