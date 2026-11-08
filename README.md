# React Insight

Runtime React developer tool that explains why components re-render.

## Packages

- `react-insight` — core engine, masking pipeline, and UI overlay.
- `@react-insight/launch-editor` — secured loopback "Jump to Code" companion.
- `@react-insight/mcp` — MCP server exposing live diagnostics to coding agents.

## Quick start

```bash
pnpm install
pnpm -r build
```

Wrap your app:

```tsx
import { ReactInsight } from 'react-insight';

<ReactInsight enabled={true}>
  <App />
</ReactInsight>;
```

## Agents

Coding agents can consume diagnostics two ways — see `AGENTS.md`:

1. **File-based:** `.react-insight/diagnostics.json` (masked, debounced, atomic).
2. **MCP:** `@react-insight/mcp` tools (`get_health_score`, `get_component_diagnostics`,
   `list_wasted_renders`, `get_masked_report`).
