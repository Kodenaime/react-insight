import { createInterface } from 'readline';
import { maskValueFast } from 'react-insight/security';
import { executeTool } from './tools';
import { logToolCall } from './audit';
import type { BridgeSnapshot } from './types';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: McpTool[] = [
  {
    name: 'get_health_score',
    description: 'Get the current whole-app architecture health score plus sub-metric breakdown.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_component_diagnostics',
    description:
      'Get render reasons, wasted-render ratio, and effect findings for a named component.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Component display name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_wasted_renders',
    description:
      'List components whose wasted-render ratio exceeds a threshold, prioritized for fixes.',
    inputSchema: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          description: 'Wasted-render ratio threshold (0-1). Default: 0.25',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_masked_report',
    description: 'Get the full current DiagnosticReportV1 (masked).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

export interface McpServer {
  start: () => void;
}

/**
 * Create an MCP server over stdio transport (newline-delimited JSON-RPC).
 *
 * Every `tools/call` result is routed through the masker (`react-insight/security`)
 * before it is returned — no exceptions. This is defense-in-depth on top of the
 * masking already applied upstream by the browser engine.
 */
export interface McpServerOptions {
  allowSensitive?: boolean;
}

export function createMcpServer(
  getSnapshot: () => BridgeSnapshot | null,
  options: McpServerOptions = {},
): McpServer {
  const allowSensitive = options.allowSensitive ?? false;
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  function send(message: unknown): void {
    process.stdout.write(JSON.stringify(message) + '\n');
  }

  function respondContent(id: unknown, text: unknown, isError: boolean): void {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(text) }],
        isError,
      },
    });
  }

  function summarizeResult(name: string, raw: unknown): unknown {
    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      if (r.status === 'no_active_session') return { status: 'no_active_session' };
      if (r.restricted) return { restricted: true };
      if (name === 'get_health_score') return { score: r.score };
      if (name === 'get_component_diagnostics') return { found: r.found, name: r.name };
      if (name === 'list_wasted_renders') return { count: r.count };
      if (name === 'get_masked_report') return { components: (r.components as unknown[])?.length };
    }
    return { kind: typeof raw };
  }

  function handleMessage(msg: any): void {
    const { id, method, params } = msg ?? {};

    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'react-insight-mcp', version: '0.1.0' },
        },
      });
      return;
    }

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return;
    }

    if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    }

    if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    }

    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments ?? {};

      let raw: unknown;
      try {
        raw = executeTool(name, args, getSnapshot(), { allowSensitive });
      } catch (err) {
        respondContent(id, { error: (err as Error).message }, true);
        return;
      }

      const masked = maskValueFast(raw);
      logToolCall({
        tool: String(name),
        args: maskValueFast(args),
        summary: summarizeResult(String(name), raw),
      });

      // Single masking gate for every tool result.
      respondContent(id, masked, false);
      return;
    }

    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }

  return {
    start() {
      rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let msg: unknown;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          return;
        }
        handleMessage(msg);
      });
    },
  };
}
