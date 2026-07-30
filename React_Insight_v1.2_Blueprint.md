# REACT INSIGHT (v1.2)
## Implementation Blueprint & Micro-Iterative Execution Plan

**Architecture Blueprint** · **7 Layers / 7 Phases / 28 Right-Sized Steps** · **Production-Grade CI & Test Scope**

*Revision notes (v1.2): adds a new Agentic Interface Layer and Phase 7, making React Insight's diagnostic output consumable by coding agents (Claude Code, Cursor, CI-based agents) — via a headless CLI, a continuously-synced session file, and an optional MCP server — in addition to the existing human-facing overlay. Phases 1–6 are unchanged from v1.1.*

---

## 1. System Architecture Blueprint

The system is now a 7-layer runtime pipeline. The first five layers are unchanged; the output of the masked diagnostic stream now fans out to **two** consumer-facing layers — one for humans, one for agents — rather than one.

```
 [ Browser / App Lifecycle ]
              │
              ▼
 ┌─────────────────────────┐   [Hook Shim Layer]
 │  window.__REACT...      │ ── Ensures hook existence; safely wraps DevTools methods
 └────────────┬────────────┘
              │ (onCommitFiberRoot)
              ▼
 ┌─────────────────────────┐   [Feature-Detected Version Compatibility Layer]
 │ r17.ts | r18.ts | r19.ts│ ── Normalizes getMemoizedProps, getHookList, getDebugSource
 └────────────┬────────────┘
              │ (Normalized Fiber API)
              ▼
 ┌─────────────────────────┐   [Instance Tracking & Smart Diff Engine]
 │ FinalizationRegistry ID │ ── Synthetic IDs + O(1) Shallow + Cycle-Safe Deep Diff
 └────────────┬────────────┘
              │ (Telemetry Event Queue)
              ▼
 ┌─────────────────────────┐   [Security & Privacy Layer]
 │ Key & Value Masking     │ ── Recursive Regex + JWT/Credit Card/Bearer Token pass
 └────────────┬────────────┘
              │ (Masked Diagnostic Stream)
              │
        ┌─────┴──────┐
        ▼            ▼
 ┌───────────────┐  ┌──────────────────────────┐   [NEW: Agentic Interface Layer]
 │ UI Drawer     │  │ Structured JSON Schema    │ ── Versioned, masked, agent-readable
 │ Overlay &     │  │ Headless CLI + Session    │    diagnostic format
 │ Launch-Editor │  │ File Sync + MCP Server    │ ── CLI for headless/CI capture
 │ Companion     │  │ (@react-insight/mcp)      │ ── Live query tools for connected agents
 └───────────────┘  └──────────────────────────┘
   [for humans]           [for agents]
```

The key architectural decision here: **the Agentic Interface Layer is a second consumer of the same masked stream, not a fork of the engine.** Nothing upstream of the Security & Privacy Layer changes. An agent never sees anything a human overlay user wouldn't also see — same masking, same truncation rules, same everything, just a different output shape (structured JSON / MCP tool calls instead of rendered UI).

---

## 2. Right-Sized Implementation Plan

### Phase 1: Foundation, Compatibility Layer & Fiber Hook Shim

**Step 1.1: Project Setup, Monorepo Configuration & Zero-Byte Export Shell**
- Initialize Monorepo (pnpm workspaces / Turborepo) containing `react-insight` (core engine) and `@react-insight/launch-editor` (optional CLI/plugin).
- Set up package build using Tsup/Rollup with conditional exports: `production.js` (noop shell) vs `development.js`.

**Step 1.2: DevTools Global Hook Shim & Multi-Extension Coexistence**
- Implement `hookShim.ts` to initialize `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` if absent.
- If present, transparently wrap all existing methods (`onCommitFiberRoot`, `inject`, etc.) with forwarders.
- Write Vitest + Playwright tests asserting both React DevTools extension and React Insight function concurrently.

**Step 1.3: Feature-Detection Feature Probe & Version Adapters**
- Create compatibility interfaces (`FiberAdapter`) and concrete adapters for React 17, 18, and 19.
- Implement runtime probes detecting Fiber fields (e.g. `_debugSource`, `tag` enum, `memoizedState` shape).
- Add fail-closed guard that disables affected inspection sub-features gracefully if unknown Fiber shapes occur.

**Step 1.4: Synthetic Instance Identity Model & Memory Cleanup**
- Build `instanceTracker.ts`: assigns stable synthetic IDs based on tree path + component type + key prop.
- Attach `FinalizationRegistry` tokens to clean up historical buffers automatically on unmount.
- Write deterministic memory leakage test asserting 1,000 mount/unmount cycles clear all state maps.

### Phase 2: Core Analysis Engines

**Step 2.1: Cycle-Safe Smart Diffing Engine**
- Implement `diffEngine.ts`: O(1) shallow reference equality check (`prev === next`).
- Implement `prev !== next` targeted deep path with a `WeakSet` cycle guard, depth limit = 4, and key limit = 50.
- Output bounded-claim messages: append `"comparison truncated at configured limits"` when limits are hit.

**Step 2.2: Render Reason Inspector & StrictMode Filter**
- Inspect prop/state reference drifts, un-memoized callbacks, parent re-renders, and context shifts.
- Filter out React 18/19 `StrictMode` intentional double-invocations so re-render counts remain accurate.

**Step 2.3: Effect Analyzer Engine**
- Track `useEffect` execution reasons, specific changed dependency indices, and trigger causes.
- Add handling for Suspense/Activity/Offscreen boundary commit semantics in React 19.

**Step 2.4: Architecture Health Score Engine**
- Implement health formula:

  ```
  health_score = 100 − (wasted renders) − (prop depth) − (inline allocations) − (context fanout) − (effect churn)
  ```

- Make weights and penalties fully user-configurable via component props.

### Phase 3: Ecosystem Adapters & Security Layer

**Step 3.1: Library-Level Ecosystem Adapters (Zustand & TanStack Query)**
- Implement `ZustandAdapter` by instrumenting the store hook's call signature to catch unselected subscriptions.
- Implement `TanStackQueryAdapter` by subscribing to `QueryClient` cache events to detect over-fetching.

**Step 3.2: Context API Telemetry Adapter**
- Track Context Provider value mutations and count consuming components across render commits.

**Step 3.3: Two-Pass Automated Masking Pipeline**
- Implement Pass 1: Key-name regex matching (`/token|password|secret|auth|creditCard|ssn|apiKey/i`).
- Implement Pass 2: Value-shape regex matching (JWT structure, Luhn credit cards, Bearer prefixes).
- Ensure masking runs recursively up to diff-engine limits before storing or exporting data.
- **Note (v1.2):** this pipeline is now the shared gate for both the human export path (Phase 3.4) and the agentic export path (Phase 7) — every consumer of diagnostic data passes through here, no exceptions.

**Step 3.4: Markdown Diagnostic Exporter**
- Implement Markdown payload generator incorporating masked diagnostic data and before/after code diffs.

### Phase 4: UI Drawer Overlay & Visualizer

**Step 4.1: Standalone UI Overlay Shell & Error Boundary Guard**
- Build floating dockable drawer component wrapped in a dedicated React Error Boundary.
- Ensure UI drawer failures fail silently to console without crashing the host React application.

**Step 4.2: Render Reason & Effect Timeline UI Views**
- Render interactive tabs displaying render causes, diff breakdowns, and effect trigger timelines.

**Step 4.3: Virtualized Component Relationship Graph (Canvas / Modal)**
- Build Dual-Mode visualizer: active component path in drawer + expandable global canvas graph.
- Implement node virtualizing/capping above 500 nodes to prevent visualizer lag in huge trees.

**Step 4.4: Code Diff Generator View**
- Build before/after refactoring code diff component showing exact `useCallback` / `useMemo` fixes.

### Phase 5: Optional Launch-Editor Companion

**Step 5.1: `@react-insight/launch-editor` Server Endpoint**
- Build lightweight HTTP handler using `launch-editor` to trigger IDE open (VS Code, Cursor, WebStorm).
- Secured: loopback-only bind, per-session token, path-traversal validation, Origin header check (see Prompt Series §13).

**Step 5.2: Vite, Webpack & Next.js Companion Plugins**
- Create plugin wrappers injecting the local launch endpoint during development.

**Step 5.3: UI Feature Detection & "Jump to Code" Button Integration**
- Probe for local endpoint presence and `_debugSource` availability in Fiber nodes.
- Show active "Jump to Code" button if present; display graceful unconfigured state if absent.

### Phase 6: Verification, Testing & Documentation

**Step 6.1: Unit & Integration Test Suite**
- Achieve >90% unit test coverage across diffing, masking, health formula, and adapters.

**Step 6.2: E2E React Version Matrix Suite**
- Run Playwright test matrix against sample applications built on React 17, 18, and 19.

**Step 6.3: Memory Leak & Performance Benchmark Automation**
- Run Puppeteer profiler verifying <3% CPU overhead and zero memory leak across 1,000 unmount cycles.

**Step 6.4: Documentation, Example App Suite & GitHub Release**
- Publish README, API docs, Next.js / Vite example apps, and publish initial v1.1 release to npm.

### Phase 7: Agentic Interface Layer *(new in v1.2)*

**Step 7.1: Versioned Structured Diagnostic Schema**
- Define `src/export/schema.ts`: a stable, versioned `DiagnosticReportV1` type (health score, per-component render reasons, wasted-render ratios, effect findings, generation timestamp, schema version field).
- This schema is the contract agents code against — treat it like a public API, version it deliberately, and never silently reshape it.

**Step 7.2: Headless CLI & Session File Sync**
- Build `packages/react-insight-cli`, invoked as `npx react-insight report --url <devServerUrl> --out <path>`: launches a headless browser against a running dev server, attaches the existing hook shim, captures a session, runs the report through the masking pipeline, and writes a single JSON file, then exits.
- Add continuous "session file sync": while the app runs in a normal browser tab, the engine can optionally write the current masked report to `.react-insight/diagnostics.json` on a debounced interval, using atomic writes (write-to-temp + rename) so a coding agent reading the file mid-write never sees a corrupt partial file.
- This is the layer that requires zero integration work from any agent — it's just a file in the repo.

**Step 7.3: MCP Server Companion (`@react-insight/mcp`)**
- Build an MCP server package exposing live-query tools (`get_health_score`, `get_component_diagnostics`, `list_wasted_renders`, `get_masked_report`) over stdio, for agents that want to query live state rather than read a snapshot file.
- Bridge the browser-resident engine to the local MCP process the same way `launch-editor` bridges to the IDE: loopback-only, token-authenticated, origin-checked — treated as at least as sensitive as the launch-editor endpoint, since data now potentially reaches a third-party model.
- Every tool result passes through the same masking pipeline as every other export path before leaving the process — no separate, unmasked path is permitted to exist.

**Step 7.4: Agent-Discoverability Documentation**
- Scaffold a root-level `AGENTS.md` describing the CLI invocation, the JSON schema, and the MCP tools available, so a coding agent operating in the repo can discover and use React Insight without a human pointing it there first.

---

## Open Items for Phase 7

- Decide whether the MCP bridge connection is agent-initiated (agent's host connects out to the browser-resident engine) or browser-initiated (browser connects out to a locally running MCP process) — this affects which side owns the loopback/token validation and should be settled before Prompt 16 (MCP Server) is implemented.
- Confirm whether `.react-insight/` should be `.gitignore`'d by default in generated projects, since session files may contain masked-but-still-detailed application telemetry that shouldn't ship in a repo.
