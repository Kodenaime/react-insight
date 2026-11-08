/**
 * Reference browser-side bridge client.
 *
 * This runs in the page (not in the MCP process). It reads the snapshot from the
 * engine via `window.__REACT_INSIGHT__.buildSnapshot()` and pushes it to the MCP
 * server's loopback listener on a debounced interval. The dev-server plugin (or a
 * manual setup) must inject `{ url, token }`, mirroring launch-editor's `<meta>`
 * token injection.
 */

export interface BrowserBridgeConfig {
  /** Full bridge endpoint, e.g. `http://127.0.0.1:4081/snapshot`. */
  url: string;
  /** Per-session token matching the server's `.react-insight/bridge.token`. */
  token: string;
  /** Push interval in ms. Default: 2000 (matches session-file-sync debounce). */
  intervalMs?: number;
  /** Override snapshot source for testing/non-standard wiring. */
  getSnapshot?: () => { report: unknown; healthScore: unknown } | null | undefined;
}

export function startBridgeClient(config: BrowserBridgeConfig): () => void {
  const intervalMs = config.intervalMs ?? 2000;
  const getSnapshot =
    config.getSnapshot ??
    (() => (globalThis as any).__REACT_INSIGHT__?.buildSnapshot?.());

  async function push(): Promise<void> {
    try {
      const snapshot = getSnapshot?.();
      if (!snapshot) return;
      await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: config.token, snapshot }),
      });
    } catch {
      // Bridge not reachable yet — retry on the next interval.
    }
  }

  void push();
  const timer = setInterval(() => void push(), intervalMs);

  return () => clearInterval(timer);
}
