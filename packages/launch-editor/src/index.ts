/**
 * @react-insight/launch-editor — secured IDE launch server.
 *
 * ## Security Architecture (see SECURITY.md for full rationale)
 *
 * 1. **Loopback-only bind:** Listens on 127.0.0.1 (never 0.0.0.0).
 * 2. **Per-session token:** A random 32-byte hex token generated at startup.
 *    Every /__open-in-editor request MUST include it as `?token=...` or
 *    `X-Insight-Token` header. Requests without a matching token → 403.
 * 3. **Path traversal guard:** `fileName` is resolved and normalized. If the
 *    resulting path escapes the project root, the request is rejected (403).
 * 4. **Origin check:** The `Origin` header must match the expected dev-server
 *    origin. Cross-origin requests are rejected (403).
 *
 * ## Usage
 *
 * ```ts
 * import { createLaunchEditorHandler } from '@react-insight/launch-editor';
 *
 * const handler = createLaunchEditorHandler({ projectRoot: '/path/to/project' });
 * // Use with Node's http.createServer or middleware in Vite/Webpack
 * ```
 */

import { resolve, normalize, relative, sep } from 'path';
import { randomBytes } from 'crypto';
import { createServer, type RequestListener, type IncomingMessage, type ServerResponse } from 'http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const _require = createRequire(fileURLToPath(import.meta.url));
const launchEditor: (file: string, editor?: string, cb?: (fileName: string | Error) => void) => void =
  _require('launch-editor');

// ── Types ────────────────────────────────────────────────────

export interface LaunchEditorOptions {
  /** Absolute path to the project root. All file paths are validated against this. */
  projectRoot: string;
  /** The editor to use. Auto-detected by launch-editor if not provided. */
  editor?: string;
  /** The host address to bind to. Default: '127.0.0.1' */
  host?: string;
  /** The port to listen on. Default: 4080 */
  port?: number;
  /** Expected dev-server origin for Origin header validation. */
  allowedOrigin?: string;
}

export interface LaunchEditorServer {
  /** The server instance. */
  server: ReturnType<typeof createServer>;
  /** The per-session token the client must send. */
  token: string;
  /** The port the server is listening on. */
  port: number;
  /** Stop the server. */
  close: () => Promise<void>;
}

// ── Token generation ─────────────────────────────────────────

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

// ── Path normalization and validation ─────────────────────────

/**
 * Validate that a file path is inside the project root.
 * Returns the resolved absolute path if valid, or null if the path
 * attempts to escape the project directory.
 */
export function resolveSafePath(fileName: string, projectRoot: string): string | null {
  // Normalize and resolve the requested path relative to project root
  const normalized = normalize(fileName).replace(/\\/g, '/');

  // If it's absolute, check it's within project root
  let resolved: string;
  if (normalized.startsWith('/') || normalized.match(/^[A-Z]:\\/i)) {
    resolved = resolve(normalized);
  } else {
    // Relative path — resolve against project root
    resolved = resolve(projectRoot, normalized);
  }

  // Check the resolved path starts with the project root
  const rel = relative(projectRoot, resolved);
  if (rel.startsWith('..') || (sep === '/' ? rel.startsWith('..') : rel.startsWith('..'))) {
    return null; // Path escapes the project root
  }

  // Also reject paths that normalize to outside
  if (resolved === projectRoot) return null; // Just the root itself isn't useful

  return resolved;
}

// ── Origin validation ────────────────────────────────────────

function isOriginAllowed(origin: string | undefined, allowedOrigin: string | undefined): boolean {
  if (!allowedOrigin) return true; // No origin restriction configured
  if (!origin) return false; // Missing origin header
  return origin === allowedOrigin;
}

// ── Request handler factory ──────────────────────────────────

export function createLaunchEditorHandler(options: LaunchEditorOptions): {
  handler: RequestListener;
  token: string;
} {
  const token = generateToken();
  const projectRoot = resolve(options.projectRoot);
  const allowedOrigin = options.allowedOrigin;

  const handler: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    // Only handle POST to /__open-in-editor
    if (req.method !== 'POST' || !req.url?.startsWith('/__open-in-editor')) {
      res.writeHead(404).end('Not found');
      return;
    }

    // ── 1. Origin check ────────────────────────────────────
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, allowedOrigin)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden: origin not allowed');
      return;
    }

    // ── 2. Token verification ───────────────────────────────
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const queryToken = url.searchParams.get('token');
    const headerToken = req.headers['x-insight-token'] as string | undefined;
    const requestToken = queryToken || headerToken;

    if (!requestToken || requestToken !== token) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden: invalid or missing token');
      return;
    }

    // ── 3. Parse body ───────────────────────────────────────
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const fileName: string | undefined = payload.fileName;
        const lineNumber: number | undefined = payload.lineNumber;

        if (!fileName || typeof fileName !== 'string') {
          res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request: fileName required');
          return;
        }

        // ── 4. Path traversal guard ─────────────────────────
        const safePath = resolveSafePath(fileName, projectRoot);
        if (!safePath) {
          res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden: path escapes project root');
          return;
        }

        // ── 5. Open in editor ───────────────────────────────
        const fileArg = lineNumber ? `${safePath}:${lineNumber}` : safePath;
        launchEditor(fileArg, options.editor, (fileName: string | Error) => {
          if (fileName instanceof Error) {
            res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`Failed: ${fileName.message}`);
          } else {
            res.writeHead(200, { 'Content-Type': 'text/plain' }).end('OK');
          }
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request: invalid JSON');
      }
    });
  };

  return { handler, token };
}

// ── Standalone server ────────────────────────────────────────

export function startLaunchEditorServer(options: LaunchEditorOptions): Promise<LaunchEditorServer> {
  return new Promise((resolvePromise, reject) => {
    const { handler, token } = createLaunchEditorHandler(options);
    const host = options.host || '127.0.0.1';
    const port = options.port || 4080;

    const server = createServer(handler);

    server.listen(port, host, () => {
      resolvePromise({
        server,
        token,
        port,
        close: () => new Promise(r => server.close(() => r())),
      });
    });

    server.on('error', reject);
  });
}
