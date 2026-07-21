# Fiber Structural Differences: React 17 vs 18 vs 19

Captured from real installs on 2026-07-20: **react@17.0.2**, **react@18.3.1**, **react@19.2.7**.

## Tag enum values (stable within this sample)

| Tag value | Meaning | Present in |
|---|---|---|
| `0` | FunctionComponent / IndeterminateComponent | r17, r18, r19 |
| `1` | ClassComponent | r17, r18, r19 |
| `3` | HostRoot | r17, r18, r19 |
| `5` | HostComponent (DOM element) | r17, r18, r19 |
| `8` | Mode (StrictMode) | r18, r19 |
| `10` | ContextProvider | r17, r18, r19 |

**Key findings:**
- Tag values appear **stable** across all three versions. No renumbering observed.
- Tag `2` (IndeterminateComponent) was not present in any snapshot — all function components resolved to `0` at commit time.
- Tag `8` (Mode/StrictMode) only appears in r18 and r19, which wrap the tree in `<StrictMode>`.
- Tag `14` (Memo), `22` (Offscreen), `24` (Cache) were not triggered by our test harness.

## StrictMode wrapping (r18 and r19 only)

r17 uses the legacy `ReactDOM.render()` API — no StrictMode wrapper is present.
r18 and r19 both use `createRoot()` with `<StrictMode>` wrapping, inserting a tag `8` Fiber (`Symbol(react.strict_mode)`) between HostRoot and the App component.

**Impact:** Version adapters must expect an optional `Mode` fiber (tag 8) between HostRoot and the app root. This affects tree-walking logic for finding the user's component boundary.

## Hook linked-list structure (identical across all three)

All three versions share the exact same hook shape:

```
Hook {
  memoizedState: <value>           // current value (number, string, array, etc.)
  baseState: <value>               // same as memoizedState on initial render
  baseQueue: null                   // no pending base updates
  queue: {
    lastRenderedState: <value>,
    hasReducer: true,               // true for useState (built-in reducer)
    pending: null,                  // no pending updates
    dispatch: '__dispatch__'
  }
  next: null | '__hookId:N'         // linked-list pointer to next hook
}
```

**Key finding:** Hook shape is **identical** across React 17, 18, and 19. The linked list structure (`memoizedState` → `baseState` → `queue` → `next`) is unchanged. This is the most important conclusion for the adapter layer: the hook serialization code can be shared.

## Effects tracking

Only r17 captured effects (tagged `updateQueue.effects` with effect descriptors). The r18 and r19 harnesses showed no effects in their captured snapshots.

**Suspected cause:** The `useEffect` callback contains a no-op. The effect may have already flushed before our capture ran, or the update queue serialization doesn't capture the `lastEffect` circular list correctly for r18/r19.

**Impact:** Adapter must handle both shapes: `updateQueue.lastEffect` (circular list of effects) and `updateQueue.firstBaseUpdate`/`shared` (state-update queue).

## Class component state

All three versions serialize class component state identically:

```json
{"count": 0, "label": "class"}
```

The `memoizedState` for class components (`tag === 1`) is the raw state object — no wrapper.

## ContextProvider: type serialization difference

| Version | `type` of tag-10 Fiber |
|---|---|
| r17 | `"(Context.Provider)"` |
| r18 | `"(Context.Provider)"` |
| r19 | `"(Context)"` |

In r19, the context provider's `type` serializes as `"(Context)"` instead of `"(Context.Provider)"`. This is because the `$$typeof` symbol changed its string representation, or the field shape changed such that the serializer picks up the context object itself rather than the Provider wrapper.

**Impact:** Version adapters must not rely on the exact string representation of `$$typeof` for context detection. Use tag value (`10`) instead, which is stable.

## `_debugSource` presence

**0 out of 20+ fibers** in all three versions have `_debugSource` populated. This is expected in a happy-dom/jsdom environment where source maps are not available — the JSX dev transform doesn't inject `__source` by default in Node.js.

**Impact:** This confirms the spec requirement (§2.4) to feature-detect `_debugSource` and hide "Jump to Code" when absent. Real browser builds with proper toolchain setup will populate it, but it cannot be assumed.

## Fiber count and tree structure

| Metric | r17 | r18 | r19 |
|---|---|---|---|
| Total fibers | 20 | 21 | 21 |
| Tag distribution | 0:5, 1:1, 3:1, 5:12, 10:1 | 0:5, 1:1, 3:1, 5:12, 8:1, 10:1 | 0:5, 1:1, 3:1, 5:12, 8:1, 10:1 |

The r18 and r19 trees are identical in structure (StrictMode adds one extra Mode fiber). All three share the same component count and layout.

## pendingProps vs memoizedProps

All components have `memoizedProps` populated after the initial render. `pendingProps` may equal `memoizedProps` after commit but can differ during concurrent rendering.

## Summary of adapter requirements

1. **Tag enums are stable** — use numeric tag values for type switching, not string representations.
2. **Hook linked-list shape is identical** across 17/18/19 — one hook parser works for all.
3. **StrictMode (tag 8) is optional** — tree walkers must handle its presence.
4. **ContextProvider is tag 10** — do not rely on `type` string for detection.
5. **`_debugSource` may be absent** — feature-detect before showing IDE links.
6. **Effect storage may differ** — handle both `lastEffect` circular list and shared-queue shapes.
