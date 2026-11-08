import { appendFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

export const DEFAULT_AUDIT_FILE = '.react-insight/mcp-audit.log';

/**
 * Append one JSON line to the local audit log and mirror a short line to stderr.
 *
 * stdout is reserved for the MCP JSON-RPC protocol, so we NEVER write there.
 * The audit entry must already be masked before it reaches this function.
 */
export function logToolCall(
  entry: { tool: string; args: unknown; summary: unknown },
  filePath: string = DEFAULT_AUDIT_FILE,
): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });

  process.stderr.write(`[react-insight-mcp] ${entry.tool}: ${JSON.stringify(entry.summary)}\n`);

  try {
    const abs = resolve(filePath);
    const dir = dirname(abs);
    if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
    appendFileSync(abs, line + '\n', 'utf8');
  } catch {
    // Audit logging must never break the MCP protocol.
  }
}
