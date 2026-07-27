/**
 * Architecture Health Score Calculator — 0–100 diagnostic score with
 * prioritized recommendations.
 *
 * ## Formula (per spec §3.1)
 *
 * ```
 * health_score = 100
 *   - min(30, wasted_render_ratio * 30)
 *   - min(20, avg_prop_depth_penalty)
 *   - min(20, inline_allocation_count * 2)
 *   - min(15, context_fanout_penalty)
 *   - min(15, effect_dependency_churn)
 * ```
 *
 * Each sub-metric maps to an actionable recommendation. The engine
 * receives ComponentHistory entries from instanceTracker and computes
 * all metrics on demand.
 *
 * ## Configurable Weights
 *
 * All weights and thresholds can be overridden via the config object,
 * exposed through `<ReactInsight config={{ healthWeights }}>`.
 */

import type { ComponentHistory } from './instanceTracker';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface HealthWeights {
  /** Penalty weight for wasted renders. Default: 30. Cap: 30 */
  wastedRenderWeight?: number;
  /** Penalty weight for deep prop drilling. Default: 20. Cap: 20 */
  propDepthWeight?: number;
  /** Penalty weight for inline allocations. Default: 20. Cap: 20 */
  inlineAllocationWeight?: number;
  /** Penalty weight for context fan-out. Default: 15. Cap: 15 */
  contextFanoutWeight?: number;
  /** Penalty weight for effect churn. Default: 15. Cap: 15 */
  effectChurnWeight?: number;
  /** Prop depth threshold (levels beyond this incur penalty). Default: 3 */
  propDepthThreshold?: number;
  /** Context consumer count threshold. Default: 5 */
  contextFanoutThreshold?: number;
}

export interface SubMetric {
  /** Machine-readable metric name. */
  name: string;
  /** Human-readable label for the UI. */
  label: string;
  /** Raw computed value (ratio, count, etc.). */
  value: number;
  /** Points deducted from 100. */
  penalty: number;
  /** Weight applied to the raw value. */
  weight: number;
  /** Whether the cap was hit. */
  capped: boolean;
}

export interface HealthRecommendation {
  /** Priority (1 = most impactful). */
  priority: number;
  /** Short title. */
  title: string;
  /** Detailed description. */
  description: string;
  /** The sub-metric this recommendation addresses. */
  metric: string;
  /** Suggested severity. */
  severity: 'critical' | 'warning' | 'info';
}

export interface HealthScore {
  /** Overall score 0–100. */
  score: number;
  /** Raw sub-metrics. */
  metrics: SubMetric[];
  /** Prioritized recommendations. */
  recommendations: HealthRecommendation[];
  /** The weights used for this computation. */
  weightsUsed: Required<HealthWeights>;
}

// ─────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────

export const DEFAULT_HEALTH_WEIGHTS: Required<HealthWeights> = {
  wastedRenderWeight: 30,
  propDepthWeight: 20,
  inlineAllocationWeight: 20,
  contextFanoutWeight: 15,
  effectChurnWeight: 15,
  propDepthThreshold: 3,
  contextFanoutThreshold: 5,
};

// ─────────────────────────────────────────────────────────────
// Telemetry data extraction helpers
// ─────────────────────────────────────────────────────────────

interface Telemetry {
  /** Total renders across all tracked components. */
  totalRenders: number;
  /** Wasted renders (PARENT_RENDER, PROP_REFERENCE_CHANGE, UNMEMOIZED_CALLBACK). */
  wastedRenders: number;
  /** Components with unbounded effects (no deps array). */
  unboundedEffectCount: number;
  /** Components by instance count. */
  componentCount: number;
  /** Render reason counts for context analysis. */
  contextConsumerRenders: number;
  /** Components with MEMO or FORWARD_REF (proxy for allocation awareness). */
  memoizedComponentCount: number;
}

function extractTelemetry(histories: ComponentHistory[]): Telemetry {
  let totalRenders = 0;
  let wastedRenders = 0;
  let unboundedEffectCount = 0;
  let contextConsumerRenders = 0;
  let memoizedComponentCount = 0;

  for (const h of histories) {
    totalRenders += h.renderCount;
    if (h.lastRenderWasted) wastedRenders++;

    if (h.lastEffectAnalysis?.hasUnboundedEffect) {
      unboundedEffectCount++;
    }

    if (h.lastRenderReason === 'CONTEXT_MUTATION') {
      contextConsumerRenders++;
    }

    // Components with useMemo indication: if they have effects but no
    // unbounded ones, they're at least aware of memoization.
    const componentName = h.componentName || '';
    if (componentName.includes('Memo') || componentName.includes('ForwardRef')) {
      memoizedComponentCount++;
    }
  }

  return {
    totalRenders,
    wastedRenders,
    unboundedEffectCount,
    componentCount: histories.length,
    contextConsumerRenders,
    memoizedComponentCount,
  };
}

// ─────────────────────────────────────────────────────────────
// Metric computation
// ─────────────────────────────────────────────────────────────

/**
 * Compute the full health score from a snapshot of component histories.
 *
 * @param histories - Current component history entries from instanceTracker.
 * @param weights - Optional weight overrides.
 * @returns Computed HealthScore.
 */
export function computeHealthScore(
  histories: ComponentHistory[],
  weights?: HealthWeights,
): HealthScore {
  const w: Required<HealthWeights> = {
    ...DEFAULT_HEALTH_WEIGHTS,
    ...weights,
  };

  const telemetry = extractTelemetry(histories);
  const metrics: SubMetric[] = [];
  const recommendations: HealthRecommendation[] = [];

  // ── 1. Wasted Render Ratio ────────────────────────────────
  // Ratio of components whose last render was wasted vs total components.
  const wasteRatio = telemetry.componentCount > 0
    ? telemetry.wastedRenders / telemetry.componentCount
    : 0;
  const wastePenalty = Math.min(w.wastedRenderWeight, wasteRatio * w.wastedRenderWeight);
  metrics.push({
    name: 'wasted_render_ratio',
    label: 'Wasted Renders',
    value: wasteRatio,
    penalty: wastePenalty,
    weight: w.wastedRenderWeight,
    capped: wasteRatio * w.wastedRenderWeight >= w.wastedRenderWeight,
  });

  if (wastePenalty >= w.wastedRenderWeight * 0.7) {
    recommendations.push({
      priority: 1,
      title: 'High proportion of wasted renders',
      description: `${Math.round(wasteRatio * 100)}% of renders are unnecessary — parent-triggered or reference-drift. Use React.memo and useMemo/useCallback to prevent cascading re-renders.`,
      metric: 'wasted_render_ratio',
      severity: 'critical',
    });
  } else if (wastePenalty > 0) {
    recommendations.push({
      priority: 2,
      title: 'Some renders are unnecessary',
      description: `${Math.round(wasteRatio * 100)}% of renders are wasted. Check for components receiving inline callbacks or recreated objects.`,
      metric: 'wasted_render_ratio',
      severity: 'warning',
    });
  }

  // ── 2. Prop Depth Penalty ─────────────────────────────────
  // Estimate prop depth from the ratio of components to renders.
  // Higher render-per-component ratio with wasted renders suggests
  // deep prop drilling (parent change cascades deep).
  const avgRendersPerComp = telemetry.componentCount > 0
    ? telemetry.totalRenders / telemetry.componentCount
    : 0;
  const depthPenaltyRaw = Math.max(0, avgRendersPerComp - w.propDepthThreshold) * (w.propDepthWeight / 5);
  const depthPenalty = Math.min(w.propDepthWeight, depthPenaltyRaw);
  metrics.push({
    name: 'avg_prop_depth_penalty',
    label: 'Prop Drilling Depth',
    value: avgRendersPerComp,
    penalty: depthPenalty,
    weight: w.propDepthWeight,
    capped: depthPenaltyRaw >= w.propDepthWeight,
  });

  if (depthPenalty >= w.propDepthWeight * 0.5) {
    recommendations.push({
      priority: recommendations.length > 0 ? 3 : 1,
      title: 'Deep component tree causing cascading renders',
      description: `Average ${avgRendersPerComp.toFixed(1)} renders per component suggests deep prop drilling. Consider context or state management to flatten updates.`,
      metric: 'avg_prop_depth_penalty',
      severity: 'warning',
    });
  }

  // ── 3. Inline Allocation Penalty ──────────────────────────
  // Count components with PARENT_RENDER or PROP_REFERENCE_CHANGE
  // as indicators of inline allocations in parent components.
  const inlineAllocCount = histories.filter(
    h => h.lastRenderReason === 'UNMEMOIZED_CALLBACK' || h.lastRenderReason === 'PROP_REFERENCE_CHANGE',
  ).length;
  const inlinePenalty = Math.min(w.inlineAllocationWeight, inlineAllocCount * 2);
  metrics.push({
    name: 'inline_allocation_count',
    label: 'Un-memoized Allocations',
    value: inlineAllocCount,
    penalty: inlinePenalty,
    weight: w.inlineAllocationWeight,
    capped: inlineAllocCount * 2 >= w.inlineAllocationWeight,
  });

  if (inlineAllocCount > 0) {
    const sev = inlineAllocCount > 3 ? 'critical' : inlineAllocCount > 1 ? 'warning' : 'info';
    recommendations.push({
      priority: 1,
      title: `${inlineAllocCount} component(s) with un-memoized callbacks or recreated objects`,
      description: `Wrap callbacks in useCallback() and objects in useMemo() to prevent unnecessary child re-renders.`,
      metric: 'inline_allocation_count',
      severity: sev as 'critical' | 'warning' | 'info',
    });
  }

  // ── 4. Context Fan-out Penalty ────────────────────────────
  const contextCount = telemetry.contextConsumerRenders;
  const fanoutPenaltyRaw = Math.max(0, contextCount - w.contextFanoutThreshold) * 2;
  const fanoutPenalty = Math.min(w.contextFanoutWeight, fanoutPenaltyRaw);
  metrics.push({
    name: 'context_fanout_penalty',
    label: 'Context Fan-out',
    value: contextCount,
    penalty: fanoutPenalty,
    weight: w.contextFanoutWeight,
    capped: fanoutPenaltyRaw >= w.contextFanoutWeight,
  });

  if (contextCount > w.contextFanoutThreshold) {
    recommendations.push({
      priority: recommendations.length > 0 ? 4 : 2,
      title: 'Broad context consumption',
      description: `${contextCount} context consumers detected. Split large context objects or use selectors to limit re-renders.`,
      metric: 'context_fanout_penalty',
      severity: 'warning',
    });
  }

  // ── 5. Effect Dependency Churn ────────────────────────────
  // Effects re-running on every commit contribute churn.
  const churnCount = telemetry.unboundedEffectCount;
  const churnPenalty = Math.min(w.effectChurnWeight, churnCount * 5);
  metrics.push({
    name: 'effect_dependency_churn',
    label: 'Effect Dependency Churn',
    value: churnCount,
    penalty: churnPenalty,
    weight: w.effectChurnWeight,
    capped: churnCount * 5 >= w.effectChurnWeight,
  });

  if (churnCount > 0) {
    const sev = churnCount > 2 ? 'critical' : 'warning';
    recommendations.push({
      priority: recommendations.length > 0 ? 5 : 3,
      title: `${churnCount} effect(s) missing dependency arrays`,
      description: `useEffect without a dependency array runs on every render. Add deps or use useMemo to limit execution.`,
      metric: 'effect_dependency_churn',
      severity: sev as 'critical' | 'warning',
    });
  }

  // ── Aggregate ─────────────────────────────────────────────
  const totalPenalty = metrics.reduce((sum, m) => sum + m.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));

  // Sort recommendations by penalty contribution descending
  const penaltyByMetric = Object.fromEntries(metrics.map(m => [m.name, m.penalty]));
  recommendations.sort((a, b) => (penaltyByMetric[b.metric] || 0) - (penaltyByMetric[a.metric] || 0));
  recommendations.forEach((r, i) => { r.priority = i + 1; });

  return {
    score: Math.round(score * 10) / 10,
    metrics,
    recommendations,
    weightsUsed: w,
  };
}

/**
 * Quickly check if the health score is in a passing range.
 */
export function isHealthy(score: number, threshold = 70): boolean {
  return score >= threshold;
}
