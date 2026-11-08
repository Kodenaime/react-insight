/**
 * JSON Exporter — serializes engine state into DiagnosticReportV1.
 *
 * This is the agent-facing serialization path. It MUST route all values
 * through the existing `masker.ts` pipeline before serialization — it does
 * NOT reimplement masking, and it does NOT read raw props/state directly.
 *
 * The only data sources are:
 *   - `getAllHistories()` — already-summarized component histories
 *   - `computeHealthScore()` — derived metrics
 *
 * Neither of these carries raw prop/state values at rest; the histories hold
 * only counts, reasons, and effect analyses. Masking is still applied as a
 * defense-in-depth gate so that any future field that DOES carry values
 * (e.g. lastProps) is redacted before it leaves this module.
 */

import type { ComponentHistory } from '../engine/instanceTracker';
import type { HealthScore } from '../engine/healthEngine';
import { maskValueFast } from '../security/masker';
import {
  SCHEMA_VERSION,
  type DiagnosticReportV1,
  type ComponentDiagnostic,
  type EffectFinding,
} from './schema';

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Serialize current component histories + health score into a masked,
 * schema-conformant DiagnosticReportV1.
 *
 * Every value is routed through maskValueFast before serialization.
 * No unmasked path exists.
 */
export function buildDiagnosticReport(
  histories: ComponentHistory[],
  healthScore: HealthScore,
): DiagnosticReportV1 {
  // ── 1. Build the report structure ─────────────────────────
  const components: ComponentDiagnostic[] = histories.map(h => {
    // Component name, instanceId, reasons, and effect findings are
    // human-readable strings/enums — not sensitive values. Masking is
    // applied to the whole object anyway as a final gate.
    const renderReasons = buildRenderReasons(h);
    const effectFindings = buildEffectFindings(h);

    const diagnostic: ComponentDiagnostic = {
      name: h.componentName,
      instanceId: h.instanceId,
      renderCount: h.renderCount,
      wastedRenderRatio: h.renderCount > 0
        ? h.wastedRenderCount / h.renderCount
        : 0,
      renderReasons,
      effectFindings,
    };

    return diagnostic;
  });

  const report: DiagnosticReportV1 = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    appHealthScore: healthScore.score,
    components,
  };

  // ── 2. Route through masking pipeline (defense-in-depth) ──
  // If any field ever carries a sensitive value (auth token, JWT, credit
  // card, etc.), maskValueFast redacts it before it leaves this module.
  return maskValueFast(report) as DiagnosticReportV1;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function buildRenderReasons(h: ComponentHistory): string[] {
  // The engine stores only the LAST render reason in ComponentHistory.
  // For now, expose that as a single-element array. The full render-reason
  // history buffer is a Phase 2 follow-up; when it lands it will extend
  // this array without a breaking schema change (additive).
  return h.lastRenderReason ? [h.lastRenderReason] : [];
}

function buildEffectFindings(h: ComponentHistory): EffectFinding[] {
  const analysis = h.lastEffectAnalysis;
  if (!analysis || analysis.effects.length === 0) return [];

  return analysis.effects.map(e => ({
    hookIndex: e.effectHookIndex,
    status: e.status,
    cause: e.cause,
    changedDependencyIndices: e.changedDeps.map(d => d.index),
  }));
}
