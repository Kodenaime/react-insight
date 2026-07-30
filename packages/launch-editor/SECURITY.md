# SECURITY.md — @react-insight/launch-editor

## Why security matters

A local HTTP endpoint that opens arbitrary files at arbitrary lines in a
developer's IDE is real local attack surface. Any web page open in the same
browser (not just your app) could send a request to `localhost:PORT` if the
port is predictable and there's no origin or path validation — this is a
classic DNS-rebinding / same-origin-adjacent local server risk.

The following constraints are MANDATORY and must not be removed or weakened.

## Security Constraints

### 1. Loopback-only bind

The server MUST bind to `127.0.0.1` only, never `0.0.0.0`. This ensures the
endpoint is not reachable from other devices on the network.

### 2. Per-session token

A random 32-byte hex token is generated at dev-server startup. Every request
to `/__open-in-editor` MUST include the token — either as a query parameter
(`?token=<value>`) or as the `X-Insight-Token` HTTP header.

Requests without a matching token are rejected with HTTP 403.

The token is injected into the client's HTML page as a `<meta>` tag
(`name="react-insight-launch-token"`) so the "Jump to Code" button can
read it and attach it to fetch requests.

### 3. Path traversal guard

The `fileName` field in the request body is resolved and normalized.
If the resulting absolute path escapes the project root (determined by
checking that `relative(projectRoot, resolvedPath)` does not start with
`..`), the request is rejected with HTTP 403 and the file is never passed
to `launch-editor`.

This prevents an attacker from requesting paths like `../../etc/passwd` or
`/etc/shadow`.

### 4. Origin header validation

The `Origin` header on incoming requests is checked against the expected
dev-server origin. Cross-origin requests are rejected with HTTP 403.

This defends against a malicious page in another tab silently POSTing to
the endpoint — even if the attacker knows the token (e.g., from reading a
leaked commit), they cannot make the browser send a cross-origin request
with a matching `Origin` header.

### 5. JSON body parsing

Only POST requests with valid JSON bodies are accepted. The body is parsed
before validation, and malformed JSON returns HTTP 400.

## Threat Model

| Threat | Mitigation |
|---|---|
| Local network attacker (same LAN) | Loopback-only bind (1) |
| XSS in another page on same origin | Origin check (4) |
| DNS rebinding | Loopback-only bind + token (1, 2) |
| Path traversal via fileName | Path normalization guard (3) |
| Brute-force token | 32-byte random token (256 bits) |
| Token leaked in source control | Rotatable per-dev, per-session |

## Responsible Disclosure

If you find a bypass for any of these constraints, please open an issue
in the React Insight repository. Do not post the bypass publicly until it
has been patched.
