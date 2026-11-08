# @react-insight/mcp

MCP server over stdio that exposes live React Insight diagnostics to coding agents.

## Tools

- `get_health_score()` — whole-app health score + sub-metric breakdown.
- `get_component_diagnostics(name)` — per-component detail (gated).
- `list_wasted_renders(threshold?)` — prioritized wasted-render list.
- `get_masked_report()` — full `DiagnosticReportV1` (gated).

Per-component detail is gated behind `--allow-sensitive` by default.

## Run

```bash
node dist/cli.js --allow-sensitive
```

The process writes `.react-insight/bridge.token`, listens on `127.0.0.1:4081` for
browser snapshot pushes, and also debounce-writes `.react-insight/diagnostics.json`.

See `ARCHITECTURE.md` and `SECURITY.md` for the bridge and threat model.
