# Fiber Fixture Snapshots

## What these are

This directory contains ground-truth Fiber tree snapshots captured from **real React installs** — not synthetic mocks, not hand-written approximations, not guessed shapes.

Each `r<version>.json` file was produced by rendering a test harness (function components, class components, hooks, Context, StrictMode) via the version's own `render()` / `createRoot()` API in a happy-dom environment, intercepting the committed Fiber tree via `window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`, and serializing it with a cycle-safe serializer.

## Why they exist

React Insight's core mechanism reads React's undocumented Fiber internals. Any test built on an invented mock shape validates a fiction, not reality. These fixtures exist so that:

- Version-adapter unit tests check against what Fiber actually looks like at runtime.
- Structural differences between React 17, 18, and 19 are surfaced empirically rather than guessed.
- New React versions can be added by regenerating the fixture and updating the adapter — no guessing required.

## Ground truth captured

| File | React version | ReactDOM version | Renderer |
|---|---|---|---|
| `r17.json` | 17.0.2 | 17.0.2 | `ReactDOM.render` (legacy) |
| `r18.json` | 18.3.1 | 18.3.1 | `createRoot` (concurrent) |
| `r19.json` | 19.2.7 | 19.2.7 | `createRoot` (concurrent) |

## ⚠️ Rules

1. **NEVER hand-edit these files.** If the shape doesn't match what you expect, regenerate them — don't patch them.
2. **Regenerate when targeting a new React version** by running `pnpm fixtures:capture` (or `node scripts/fixture-capture/capture-all.mjs`).
3. **Regenerate when the test harness changes** (new component types, hooks, or patterns added).
4. **Commit changes to these files along with adapter changes** — they are the source of truth for which Fiber shapes the adapters must handle.

## How to regenerate

```bash
# From the monorepo root
pnpm fixtures:capture

# Or directly
node scripts/fixture-capture/capture-all.mjs
```

This will install dependencies in each sub-project (if needed) and produce updated `r17.json`, `r18.json`, and `r19.json` files.
