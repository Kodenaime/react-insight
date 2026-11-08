import { resolve } from 'path';
import { startBridgeServer } from './bridge';
import { createMcpServer } from './server';
import { generateToken, writeTokenFile } from './token';

export interface StartMcpOptions {
  host?: string;
  port?: number;
  allowedOrigin?: string;
  tokenFile?: string;
  sessionTtlMs?: number;
  allowSensitive?: boolean;
  sessionFile?: string;
}

export const DEFAULT_PORT = 4081;
export const DEFAULT_TOKEN_FILE = '.react-insight/bridge.token';
export const DEFAULT_SESSION_FILE = '.react-insight/diagnostics.json';

/**
 * Start the bridge listener and the stdio MCP server in the same process.
 */
export function startMcp(options: StartMcpOptions = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? DEFAULT_PORT;
  const tokenFile = options.tokenFile ?? DEFAULT_TOKEN_FILE;
  const token = generateToken();

  writeTokenFile(resolve(tokenFile), token);

  const bridge = startBridgeServer({
    host,
    port,
    allowedOrigin: options.allowedOrigin,
    token,
    sessionTtlMs: options.sessionTtlMs,
    sessionFile: options.sessionFile ?? DEFAULT_SESSION_FILE,
  });

  const mcp = createMcpServer(() => bridge.getLatestSnapshot(), {
    allowSensitive: options.allowSensitive,
  });
  mcp.start();

  return { bridge, mcp, token, tokenFile };
}

export { createMcpServer, TOOLS } from './server';
export {
  executeTool,
  NO_ACTIVE_SESSION,
  DEFAULT_WASTED_RENDER_THRESHOLD,
} from './tools';
export { createBridgeHandler, startBridgeServer } from './bridge';
export {
  assertLoopbackHost,
  verifyToken,
  validateOrigin,
  verifyHandshake,
} from './security';
export { generateToken, writeTokenFile } from './token';
export { startBridgeClient } from './browser-client';
export type { BrowserBridgeConfig } from './browser-client';
export type { BridgeSnapshot, HealthScoreSnapshot, NoActiveSession } from './types';
