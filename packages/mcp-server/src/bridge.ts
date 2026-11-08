import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { assertLoopbackHost, verifyHandshake } from './security';
import { writeJsonAtomic } from './writeSnapshot';
import type { BridgeSnapshot } from './types';

export interface BridgeOptions {
  host?: string;
  port?: number;
  allowedOrigin?: string;
  token: string;
  /** Milliseconds since the last push before a session is considered stale. */
  sessionTtlMs?: number;
  /** Where to debounce-write the latest masked report (session-file path). */
  sessionFile?: string;
}

export interface SubmitResult {
  ok: boolean;
  status: number;
  reason?: 'missing_token' | 'invalid_token' | 'invalid_origin';
}

export interface BridgeHandler {
  token: string;
  host: string;
  port: number;
  handler: (req: IncomingMessage, res: ServerResponse) => void;
  submitSnapshot: (input: {
    token?: string | null;
    origin?: string;
    snapshot: BridgeSnapshot;
  }) => SubmitResult;
  getLatestSnapshot: () => BridgeSnapshot | null;
}

export interface BridgeServer extends BridgeHandler {
  close: () => Promise<void>;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4081;
const DEFAULT_SESSION_TTL_MS = 30_000;
const SNAPSHOT_PATH = '/snapshot';

function handleCorsPreflight(
  res: ServerResponse,
  allowedOrigin: string | undefined,
): void {
  const headers: Record<string, string> = {};
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  headers['Access-Control-Max-Age'] = '600';
  res.writeHead(204, headers).end();
}

/**
 * Build the bridge without binding a socket. This keeps the security logic
 * testable (mirroring launch-editor's `createLaunchEditorHandler`).
 */
export function createBridgeHandler(options: BridgeOptions): BridgeHandler {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const allowedOrigin = options.allowedOrigin;
  const token = options.token;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const sessionFile = options.sessionFile ?? '.react-insight/diagnostics.json';

  // Refuse non-loopback before doing anything else.
  assertLoopbackHost(host);

  let latest: BridgeSnapshot | null = null;
  let lastPushAt = 0;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFileWrite(): void {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      try {
        if (latest) writeJsonAtomic(sessionFile, latest.report);
      } catch {
        // File sync must never break the bridge.
      }
    }, 2000);
  }

  function submitSnapshot(input: {
    token?: string | null;
    origin?: string;
    snapshot: BridgeSnapshot;
  }): SubmitResult {
    const handshake = verifyHandshake({
      token: input.token,
      origin: input.origin,
      expectedToken: token,
      allowedOrigin,
    });

    if (!handshake.ok) {
      return { ok: false, status: 403, reason: handshake.reason };
    }

    latest = input.snapshot;
    lastPushAt = Date.now();
    scheduleFileWrite();
    return { ok: true, status: 200 };
  }

  function getLatestSnapshot(): BridgeSnapshot | null {
    if (!latest) return null;
    if (Date.now() - lastPushAt > sessionTtlMs) return null;
    return latest;
  }

  function handler(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'OPTIONS') {
      handleCorsPreflight(res, allowedOrigin);
      return;
    }

    if (req.method !== 'POST' || !req.url?.startsWith(SNAPSHOT_PATH)) {
      res.writeHead(404).end('Not found');
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      let payload: { token?: unknown; snapshot?: BridgeSnapshot } = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ ok: false, reason: 'invalid_json' }),
        );
        return;
      }

      const result = submitSnapshot({
        token: typeof payload.token === 'string' ? payload.token : undefined,
        origin: req.headers.origin,
        snapshot: payload.snapshot as BridgeSnapshot,
      });

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;

      res.writeHead(result.status, headers).end(
        JSON.stringify({ ok: result.ok, reason: result.reason }),
      );
    });
  }

  return { token, host, port, handler, submitSnapshot, getLatestSnapshot };
}

/**
 * Start the bridge listener. Used by the CLI entry for a real running server.
 */
export function startBridgeServer(options: BridgeOptions): BridgeServer {
  const bridge = createBridgeHandler(options);
  const server = createServer(bridge.handler);

  server.listen(bridge.port, bridge.host);

  return {
    ...bridge,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
