# SECURITY.md — @react-insight/mcp

## Why this is higher-stakes than launch-editor

`launch-editor` opens a file in a local IDE. This server returns **live
application diagnostic data** to a third-party process — an agent's host, which
may itself be talking to a cloud-hosted model. Every constraint from
`launch-editor`'s `SECURITY.md` applies here at minimum, not as a lesser variant.

The data returned is always masked (see "What this server can and cannot
expose" below), but a local listener that leaks any telemetry to an unrelated
page or process is still a real exfiltration channel.

## Bridge direction

The browser-resident engine initiates outbound `POST /snapshot` pushes to a
loopback HTTP listener owned by the MCP server. The browser never opens a
listener. See `ARCHITECTURE.md` for the full rationale.

## Security constraints (mandatory)

### 1. Loopback-only bind

The bridge listener MUST bind to `127.0.0.1` (or `::1`), never `0.0.0.0`.
`assertLoopbackHost()` throws before binding on any other address.

### 2. Per-session token

A 32-byte random hex token (64 chars) is generated at server startup and written
to `.react-insight/bridge.token` (gitignored). Every bridge message must carry it.

- Missing token → rejected (`missing_token`).
- Mismatched token → rejected (`invalid_token`).
- Comparison is constant-time via `timingSafeEqual`.

### 3. Origin / handshake validation

The browser `Origin` header on every push is checked against the configured
dev-server origin. Mismatched or missing origins are rejected (`invalid_origin`).

### 4. No active session

If no validly-authenticated snapshot has been received within the session TTL
(default 30s), MCP tools return a structured `no_active_session` result
immediately. They never hang waiting for a connection.

### 5. Masking on every tool result

Every `tools/call` result is routed through `react-insight/security`
(the same `masker.ts` used upstream) before it is returned. This is
defense-in-depth on top of the browser engine's own masking.

## What this server can and cannot expose

**Can expose** (always masked):

- Whole-app health score and sub-metric breakdown.
- Per-component render reasons, wasted-render ratios, and effect findings.
- The full `DiagnosticReportV1` — the same schema produced by the Prompt 15 CLI.

**Cannot expose**, regardless of caller or arguments:

- Raw, unmasked prop/state values. Every path passes through the masker, and
  there is no separate unmasked code path.
- Anything outside the `DiagnosticReportV1` shape. The bridge only accepts a
  snapshot object whose fields are the versioned schema; it has no generic
  "read arbitrary data" capability.

## Threat model

| Threat | Mitigation |
|---|---|
| Local network attacker (same LAN) | Loopback-only bind (1) |
| Malicious page in another tab | Origin validation (3) + token (2) |
| DNS rebinding | Loopback-only bind + token (1, 2) |
| Brute-force token | 32-byte random token (256 bits), constant-time compare (2) |
| Token leaked in source control | Per-session, gitignored, rotatable (2) |
| Unmasked telemetry leaking to the agent | Masking gate on every tool result (5) |
| Agent polls with no browser connected | Structured `no_active_session`, no hang (4) |

## Manual verification

A well-formed, authorized request succeeds end-to-end against a running example
app:

1. Start the MCP server (`pnpm --filter @react-insight/mcp dev` or the built bin).
   It writes `.react-insight/bridge.token` and listens on `127.0.0.1:4081`.
2. Start a React Insight dev app and inject the bridge config (see
   `browser-client.ts`): `{ url: 'http://127.0.0.1:4081/snapshot', token }`.
3. Confirm the browser pushes `POST /snapshot` with the correct `Origin` + token
   and the server stores the snapshot.
4. Invoke an MCP tool (`get_health_score`, `get_component_diagnostics`,
   `list_wasted_renders`, or `get_masked_report`) over stdio. It returns masked
   JSON and does not hang when no session is active.
