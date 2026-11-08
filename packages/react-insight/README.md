# react-insight

Core engine + overlay for React Insight.

## Exports

- `.` — the `<ReactInsight />` component. Dev builds install the hook shim and
  engine; production builds resolve to a small noop shell.
- `./security` — the two-pass masking pipeline (`maskValueFast`, `maskValue`).
- `./schema` — `DiagnosticReportV1` and `SCHEMA_VERSION` (the agent-facing contract).
