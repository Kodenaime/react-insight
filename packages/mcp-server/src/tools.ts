import type { BridgeSnapshot, NoActiveSession } from './types';

/** Documented default wasted-render-ratio threshold for list_wasted_renders. */
export const DEFAULT_WASTED_RENDER_THRESHOLD = 0.25;

export const NO_ACTIVE_SESSION: NoActiveSession = {
  status: 'no_active_session',
  message:
    'No browser session is currently connected to the React Insight bridge. ' +
    'Start your dev server with React Insight enabled and ensure the bridge ' +
    'client is pushing snapshots to the local MCP server.',
};

export const RESTRICTED = {
  restricted: true,
  reason: 'per-component detail requires --allow-sensitive',
};

export interface ToolOptions {
  allowSensitive: boolean;
}

function getHealthScore(snapshot: BridgeSnapshot) {
  return snapshot.healthScore;
}

function getComponentDiagnostics(snapshot: BridgeSnapshot, name?: string) {
  const components = snapshot.report.components;
  const match = components.find(c => c.name === name);

  if (!match) {
    return {
      found: false,
      name: name ?? null,
      message: `No component named "${name}" is currently tracked.`,
    };
  }

  return {
    found: true,
    name: match.name,
    instanceId: match.instanceId,
    renderCount: match.renderCount,
    wastedRenderRatio: match.wastedRenderRatio,
    renderReasons: match.renderReasons,
    effectFindings: match.effectFindings,
  };
}

function listWastedRenders(snapshot: BridgeSnapshot, threshold?: number) {
  const t = typeof threshold === 'number' ? threshold : DEFAULT_WASTED_RENDER_THRESHOLD;
  const components = snapshot.report.components
    .filter(c => c.wastedRenderRatio > t)
    .sort((a, b) => b.wastedRenderRatio - a.wastedRenderRatio)
    .map(c => ({
      name: c.name,
      instanceId: c.instanceId,
      wastedRenderRatio: c.wastedRenderRatio,
      renderCount: c.renderCount,
    }));

  return { threshold: t, count: components.length, components };
}

function getMaskedReport(snapshot: BridgeSnapshot) {
  return snapshot.report;
}

/**
 * Execute an MCP tool against the current bridge snapshot.
 *
 * Returns `NO_ACTIVE_SESSION` when there is no live browser session, and throws
 * for an unknown tool name. The caller is responsible for masking the result.
 */
export function executeTool(
  name: string,
  args: Record<string, unknown>,
  snapshot: BridgeSnapshot | null,
  options: ToolOptions = { allowSensitive: false },
): unknown {
  if (!snapshot) return NO_ACTIVE_SESSION;

  switch (name) {
    case 'get_health_score':
      return getHealthScore(snapshot);
    case 'get_component_diagnostics':
      if (!options.allowSensitive) return RESTRICTED;
      return getComponentDiagnostics(
        snapshot,
        typeof args?.name === 'string' ? args.name : undefined,
      );
    case 'list_wasted_renders':
      return listWastedRenders(
        snapshot,
        typeof args?.threshold === 'number' ? args.threshold : undefined,
      );
    case 'get_masked_report':
      if (!options.allowSensitive) return RESTRICTED;
      return getMaskedReport(snapshot);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
