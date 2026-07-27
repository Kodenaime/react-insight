/**
 * Health Engine — test suite.
 *
 * Verifies the formula produces expected scores for clean and degraded
 * applications, and that recommendations are prioritized correctly.
 */

import { describe, it, expect } from 'vitest';
import {
  computeHealthScore,
  isHealthy,
  DEFAULT_HEALTH_WEIGHTS,
} from '../src/engine/healthEngine';
import type { ComponentHistory } from '../src/engine/instanceTracker';
import type { EffectAnalysis, EffectAnalysisResult } from '../src/engine/effectAnalyzer';

// ── Helpers ──────────────────────────────────────────────────

function makeHistory(overrides: Partial<ComponentHistory>): ComponentHistory {
  return {
    instanceId: 'Comp||0',
    renderCount: 1,
    componentName: 'Comp',
    lastRenderReason: 'MOUNT',
    lastRenderWasted: false,
    ...overrides,
  };
}

function makeEffectAnalysis(overrides: Partial<EffectAnalysis> = {}): EffectAnalysis {
  return {
    instanceId: 'Comp||0',
    componentName: 'Comp',
    effects: [],
    hasUnboundedEffect: false,
    isOffscreenBound: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('healthEngine — computeHealthScore', () => {
  describe('clean application', () => {
    it('returns near 100 for a pristine app with no wasted renders', () => {
      const histories: ComponentHistory[] = [
        makeHistory({ renderCount: 1, lastRenderReason: 'MOUNT', lastRenderWasted: false }),
        makeHistory({ instanceId: 'A||1', componentName: 'A', renderCount: 1, lastRenderReason: 'MOUNT', lastRenderWasted: false }),
        makeHistory({ instanceId: 'B||2', componentName: 'B', renderCount: 1, lastRenderReason: 'MOUNT', lastRenderWasted: false }),
      ];

      const result = computeHealthScore(histories);

      expect(result.score).toBeGreaterThan(95);
      expect(result.recommendations.length).toBeLessThanOrEqual(2); // minor info only
    });

    it('returns 100 for no components', () => {
      const result = computeHealthScore([]);
      expect(result.score).toBe(100);
      expect(result.recommendations).toHaveLength(0);
    });

    it('returns score with no penalty when all renders are mounted only', () => {
      const histories: ComponentHistory[] = Array.from({ length: 5 }, (_, i) =>
        makeHistory({
          instanceId: `Clean${i}||${i}`,
          componentName: `Clean${i}`,
          renderCount: 1,
          lastRenderReason: 'MOUNT',
          lastRenderWasted: false,
        }),
      );

      const result = computeHealthScore(histories);
      expect(result.score).toBe(100);
    });
  });

  describe('degraded application', () => {
    it('deducts for wasted renders', () => {
      // 10 components where last render was wasted on all of them
      const histories: ComponentHistory[] = Array.from({ length: 10 }, (_, i) =>
        makeHistory({
          instanceId: `Waste${i}||${i}`,
          componentName: `Waste${i}`,
          renderCount: 10,
          lastRenderReason: 'PARENT_RENDER',
          lastRenderWasted: true,
          lastEffectAnalysis: makeEffectAnalysis(),
        }),
      );

      const result = computeHealthScore(histories);

      // wasteRatio = 10/10 = 1.0 → penalty = min(30, 1.0*30) = 30
      // score should be around 70
      expect(result.score).toBeLessThan(75);
      expect(result.score).toBeGreaterThanOrEqual(40);
      expect(result.metrics.find(m => m.name === 'wasted_render_ratio')!.penalty).toBeGreaterThan(25);
    });

    it('deducts for inline allocations (un-memoized callbacks)', () => {
      // 5 components with UNMEMOIZED_CALLBACK
      const histories: ComponentHistory[] = Array.from({ length: 7 }, (_, i) =>
        makeHistory({
          instanceId: `Inline${i}||${i}`,
          componentName: `Inline${i}`,
          renderCount: 3,
          lastRenderReason: i < 5 ? 'UNMEMOIZED_CALLBACK' : 'MOUNT',
          lastRenderWasted: i < 5,
        }),
      );

      const result = computeHealthScore(histories);

      // inlineAllocationCount = 5 → penalty = min(20, 5*2) = 10
      const inlineMetric = result.metrics.find(m => m.name === 'inline_allocation_count')!;
      expect(inlineMetric.value).toBe(5);
      expect(inlineMetric.penalty).toBe(10);
      expect(result.score).toBeLessThan(90);
    });

    it('caps inline allocation penalty at 20', () => {
      const histories: ComponentHistory[] = Array.from({ length: 15 }, (_, i) =>
        makeHistory({
          instanceId: `Bad${i}||${i}`,
          lastRenderReason: 'UNMEMOIZED_CALLBACK',
          lastRenderWasted: true,
        }),
      );

      const result = computeHealthScore(histories);
      const inlineMetric = result.metrics.find(m => m.name === 'inline_allocation_count')!;

      // 15 * 2 = 30, capped at 20
      expect(inlineMetric.penalty).toBe(20);
      expect(inlineMetric.capped).toBe(true);
    });

    it('deducts for effects without dependency arrays', () => {
      const unboundedEffect = makeEffectAnalysis({ hasUnboundedEffect: true });
      const histories: ComponentHistory[] = [
        makeHistory({
          lastRenderReason: 'STATE_CHANGE',
          lastRenderWasted: false,
          lastEffectAnalysis: unboundedEffect,
        }),
        makeHistory({
          instanceId: 'B||1',
          componentName: 'B',
          lastRenderReason: 'MOUNT',
          lastRenderWasted: false,
          lastEffectAnalysis: unboundedEffect,
        }),
      ];

      const result = computeHealthScore(histories);

      // churnCount = 2 → penalty = min(15, 2*5) = 10
      const churnMetric = result.metrics.find(m => m.name === 'effect_dependency_churn')!;
      expect(churnMetric.value).toBe(2);
      expect(churnMetric.penalty).toBe(10);
    });

    it('caps effect churn penalty at 15', () => {
      const unboundedEffect = makeEffectAnalysis({ hasUnboundedEffect: true });
      const histories: ComponentHistory[] = Array.from({ length: 10 }, (_, i) =>
        makeHistory({
          instanceId: `E${i}||${i}`,
          lastRenderReason: 'STATE_CHANGE',
          lastRenderWasted: false,
          lastEffectAnalysis: unboundedEffect,
        }),
      );

      const result = computeHealthScore(histories);

      // 10 * 5 = 50, capped at 15
      const churnMetric = result.metrics.find(m => m.name === 'effect_dependency_churn')!;
      expect(churnMetric.penalty).toBe(15);
      expect(churnMetric.capped).toBe(true);
    });

    it('deducts for high context consumer count', () => {
      const histories: ComponentHistory[] = Array.from({ length: 10 }, (_, i) =>
        makeHistory({
          instanceId: `Ctx_${i}||${i}`,
          lastRenderReason: 'CONTEXT_MUTATION',
          lastRenderWasted: false,
        }),
      );

      const result = computeHealthScore(histories);

      // contextCount = 10, threshold = 5 → fanoutPenaltyRaw = (10-5)*2 = 10
      const ctxMetric = result.metrics.find(m => m.name === 'context_fanout_penalty')!;
      expect(ctxMetric.value).toBe(10);
      expect(ctxMetric.penalty).toBe(10);
    });

    it('score can drop to near 0 with maximum penalties across all metrics', () => {
      // Max out all 5 penalty categories
      const unboundedEffect = makeEffectAnalysis({ hasUnboundedEffect: true });

      // 50 components: all wasted, all with unbounded effects, all with inline allocs,
      // 15 context consumers. High render count per component for depth penalty.
      const histories: ComponentHistory[] = Array.from({ length: 50 }, (_, i) =>
        makeHistory({
          instanceId: `Max${i}||${i}`,
          componentName: `Max${i}`,
          renderCount: 20, // drives depth penalty
          lastRenderReason: i < 15 ? 'UNMEMOIZED_CALLBACK'
            : i < 30 ? 'PARENT_RENDER'
            : i < 40 ? 'CONTEXT_MUTATION'
            : 'PROP_REFERENCE_CHANGE',
          lastRenderWasted: i < 30 ? true : i >= 40, // 40 out of 50 wasted
          lastEffectAnalysis: i < 10 ? unboundedEffect : makeEffectAnalysis(),
        }),
      );

      const result = computeHealthScore(histories);

      // waste ratio = 40/50 = 0.8 → penalty = 24 (cap 30)
      // depth penalty: avg renders/comp = 20, threshold = 3, raw = (20-3)*(20/5) = 68 → cap 20
      // inline: 15 allocations → penalty = 20 (capped)
      // context: 10 consumers, threshold 5 → (10-5)*2 = 10 penalty
      // churn: 10 unbounded → penalty = 15 (capped)
      // total: 24+20+20+10+15 = 89 → score ~11
      expect(result.score).toBeLessThan(20);
      // At least 3 metrics should be capped
      expect(result.metrics.filter(m => m.capped).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('recommendations', () => {
    it('returns critical recommendation for high waste ratio', () => {
      const histories: ComponentHistory[] = Array.from({ length: 10 }, (_, i) =>
        makeHistory({
          instanceId: `W${i}||${i}`,
          lastRenderReason: 'PARENT_RENDER',
          lastRenderWasted: true,
        }),
      );

      const result = computeHealthScore(histories);
      const wasteRec = result.recommendations.find(r => r.metric === 'wasted_render_ratio');
      expect(wasteRec).toBeDefined();
      expect(wasteRec!.severity).toBe('critical');
    });

    it('returns recommendation for inline allocations', () => {
      const histories: ComponentHistory[] = Array.from({ length: 4 }, (_, i) =>
        makeHistory({
          instanceId: `I${i}||${i}`,
          lastRenderReason: 'UNMEMOIZED_CALLBACK',
          lastRenderWasted: true,
        }),
      );

      const result = computeHealthScore(histories);
      const inlineRec = result.recommendations.find(r => r.metric === 'inline_allocation_count');
      expect(inlineRec).toBeDefined();
      expect(inlineRec!.title).toContain('un-memoized');
    });

    it('recommendations are sorted by penalty contribution', () => {
      const unboundedEffect = makeEffectAnalysis({ hasUnboundedEffect: true });
      const histories: ComponentHistory[] = [
        // 10 wasted renders + 2 unbounded effects
        ...Array.from({ length: 10 }, (_, i) =>
          makeHistory({
            instanceId: `W${i}||${i}`,
            lastRenderReason: 'PARENT_RENDER',
            lastRenderWasted: true,
            lastEffectAnalysis: i < 2 ? unboundedEffect : makeEffectAnalysis(),
          }),
        ),
      ];

      const result = computeHealthScore(histories);

      // First recommendation should be the most impactful
      expect(result.recommendations.length).toBeGreaterThanOrEqual(2);
      expect(result.recommendations[0].priority).toBe(1);
    });

    it('returns no recommendations for clean app', () => {
      const result = computeHealthScore([]);
      expect(result.recommendations).toHaveLength(0);
    });
  });

  describe('isHealthy helper', () => {
    it('returns true for score >= 70 (default threshold)', () => {
      expect(isHealthy(100)).toBe(true);
      expect(isHealthy(70)).toBe(true);
      expect(isHealthy(85)).toBe(true);
    });

    it('returns false for score < 70', () => {
      expect(isHealthy(69)).toBe(false);
      expect(isHealthy(0)).toBe(false);
      expect(isHealthy(30)).toBe(false);
    });

    it('accepts custom threshold', () => {
      expect(isHealthy(50, 50)).toBe(true);
      expect(isHealthy(49, 50)).toBe(false);
    });
  });

  describe('custom weights', () => {
    it('accepts weight overrides', () => {
      const histories: ComponentHistory[] = Array.from({ length: 10 }, (_, i) =>
        makeHistory({
          instanceId: `W${i}||${i}`,
          renderCount: 5,
          lastRenderReason: 'PARENT_RENDER',
          lastRenderWasted: true,
        }),
      );

      const defaultResult = computeHealthScore(histories);
      const customResult = computeHealthScore(histories, { wastedRenderWeight: 50 });

      // With a higher weight, penalty should be higher
      expect(customResult.weightsUsed.wastedRenderWeight).toBe(50);
      expect(defaultResult.weightsUsed.wastedRenderWeight).toBe(DEFAULT_HEALTH_WEIGHTS.wastedRenderWeight);
    });

    it('reports which weights were used in the result', () => {
      const result = computeHealthScore([], { propDepthThreshold: 5 });
      expect(result.weightsUsed.propDepthThreshold).toBe(5);
      expect(result.weightsUsed.wastedRenderWeight).toBe(DEFAULT_HEALTH_WEIGHTS.wastedRenderWeight);
    });
  });
});
