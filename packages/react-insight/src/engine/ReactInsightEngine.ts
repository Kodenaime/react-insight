/**
 * ReactInsightEngine — commit-pipeline orchestrator.
 *
 * Called from the DevTools hook shim's `onCommitFiberRoot` callback on every
 * committed render. Walks the committed Fiber tree, tracks component instances,
 * classifies render reasons, analyzes effects, computes health scores, and
 * feeds data into the analysis engines.
 *
 * ## Pipeline
 *
 * ```
 * onCommitFiberRoot(rendererID, root)
 *   └─ analyzeCommit(fiberRoot, rendererID)
 *        ├─ Walk down the Fiber tree via FiberAdapter
 *        ├─ For each component fiber:
 *        │    ├─ trackInstance() → syntheticInstanceId
 *        │    ├─ classifyRender() → ComponentRenderResult
 *        │    ├─ analyzeEffects() → EffectAnalysis
 *        │    ├─ incrementRenderCount()
 *        │    └─ Update ComponentHistory with render reason + effect analysis
 *        ├─ computeHealthScore() → HealthScore (on demand via getHealthScore)
 *        └─ (Phase 3+: ecosystem adapters, masking, etc.)
 * ```
 *
 * ## StrictMode (§2.2 of spec / FINDINGS.md)
 *
 * The probe (scripts/strictmode-probe/) confirmed that StrictMode does NOT
 * produce duplicate onCommitFiberRoot calls. Render counts are accurate.
 * No filter needed at the commit level. The STRICT_MODE_DOUBLE_INVOCATION
 * filter is applied at the effect analysis layer, where the
 * mount → cleanup → remount pattern IS observable.
 */

import { probeAdapter, isComponentFiber, type FiberAdapter } from './FiberAdapter';
import {
  trackInstance,
  trackInstanceCleanup,
  incrementRenderCount,
  _resetHistoryStore,
  getInstanceId,
  _getHistory,
  getAllHistories,
  type ComponentHistory,
} from './instanceTracker';
import { buildDiagnosticReport } from '../export/jsonExporter';
import type { DiagnosticReportV1 } from '../export/schema';
import { analyzeComponentRender, _resetPrevSnapshots } from './renderInspector';
import { analyzeEffects, _resetEffectStore } from './effectAnalyzer';
import { computeHealthScore, type HealthScore, type HealthWeights } from './healthEngine';
import { ZustandAdapter } from '../adapters/zustand';
import { TanStackQueryAdapter } from '../adapters/tanstackQuery';
import type { AdapterWarning } from '../adapters/types';

// ── Active adapters ──────────────────────────────────────────

const ADAPTERS = [ZustandAdapter, TanStackQueryAdapter];

// ─────────────────────────────────────────────────────────────
// Engine interface
// ─────────────────────────────────────────────────────────────

export interface ReactInsightEngineAPI {
  analyzeCommit: (fiberRoot: unknown, rendererID: number) => void;
  handleUnmount: (fiber: unknown) => void;
  getHealthScore: (weights?: HealthWeights) => HealthScore;
  getSnapshot: () => { histories: ComponentHistory[]; healthScore: HealthScore };
  buildReport: () => DiagnosticReportV1;
  buildSnapshot: () => { report: DiagnosticReportV1; healthScore: HealthScore };
  getAdapterWarnings: () => AdapterWarning[];
  /** @internal */
  _reset: () => void;
}

// ─────────────────────────────────────────────────────────────
// Adapter resolution (per-commit)
// ─────────────────────────────────────────────────────────────

function resolveAdapter(_fiberRoot: unknown): FiberAdapter {
  return probeAdapter;
}

// ─────────────────────────────────────────────────────────────
// Tree walker
// ─────────────────────────────────────────────────────────────

function walkCommittedFiber(fiber: unknown, adapter: FiberAdapter): void {
  let cursor: unknown | null = fiber;

  while (cursor) {
    const tag = adapter.getTag(cursor);

    if (isComponentFiber(tag)) {
      const instanceId = trackInstance(cursor, adapter);

      // Classify the render reason
      const renderResult = analyzeComponentRender(instanceId, cursor, adapter);

      // Analyze effects
      const effectAnalysis = analyzeEffects(cursor, adapter, instanceId);

      // Update history
      const history = _getHistory(instanceId);
      if (history) {
        history.lastRenderReason = renderResult.reason;
        history.lastRenderWasted = renderResult.wasted;
        history.lastEffectAnalysis = effectAnalysis;
        if (renderResult.wasted) history.wastedRenderCount++;
      }

      incrementRenderCount(instanceId);
    }

    const child = adapter.getChild(cursor);
    if (child) {
      walkCommittedFiber(child, adapter);
    }

    cursor = adapter.getSibling(cursor);
  }
}

// ─────────────────────────────────────────────────────────────
// Engine singleton
// ─────────────────────────────────────────────────────────────

export const ReactInsightEngine: ReactInsightEngineAPI = {
  analyzeCommit(fiberRoot: unknown, _rendererID: number): void {
    if (!fiberRoot) return;

    const adapter = resolveAdapter(fiberRoot);
    const tag = adapter.getTag(fiberRoot);

    if (isComponentFiber(tag)) {
      const instanceId = trackInstance(fiberRoot, adapter);
      const renderResult = analyzeComponentRender(instanceId, fiberRoot, adapter);
      const effectAnalysis = analyzeEffects(fiberRoot, adapter, instanceId);
      const history = _getHistory(instanceId);
      if (history) {
        history.lastRenderReason = renderResult.reason;
        history.lastRenderWasted = renderResult.wasted;
        history.lastEffectAnalysis = effectAnalysis;
        if (renderResult.wasted) history.wastedRenderCount++;
      }
      incrementRenderCount(instanceId);
    }

    const child = adapter.getChild(fiberRoot);
    if (child) {
      walkCommittedFiber(child, adapter);
    }
  },

  handleUnmount(fiber: unknown): void {
    if (!fiber) return;
    const adapter = resolveAdapter(fiber);
    const tag = adapter.getTag(fiber);
    if (isComponentFiber(tag)) {
      const instanceId = getInstanceId(fiber, adapter);
      trackInstanceCleanup(instanceId);
    }
  },

  getHealthScore(weights?: HealthWeights): HealthScore {
    const histories = getAllHistories();
    return computeHealthScore(histories, weights);
  },

  getSnapshot(): { histories: ComponentHistory[]; healthScore: HealthScore } {
    const histories = getAllHistories();
    return { histories, healthScore: computeHealthScore(histories) };
  },

  buildReport(): DiagnosticReportV1 {
    const histories = getAllHistories();
    return buildDiagnosticReport(histories, computeHealthScore(histories));
  },

  buildSnapshot(): { report: DiagnosticReportV1; healthScore: HealthScore } {
    const histories = getAllHistories();
    const healthScore = computeHealthScore(histories);
    return { report: buildDiagnosticReport(histories, healthScore), healthScore };
  },

  getAdapterWarnings(): AdapterWarning[] {
    const all: AdapterWarning[] = [];
    for (const adapter of ADAPTERS) {
      const getter = (adapter as any)._getWarnings;
      if (typeof getter === 'function') {
        all.push(...getter());
      }
    }
    return all;
  },

  /** @internal */
  _reset(): void {
    _resetHistoryStore();
    _resetPrevSnapshots();
    _resetEffectStore();
  },
};

// ── Adapter lifecycle ─────────────────────────────────────────

/** @internal */
export function _initAdapters(): void {
  for (const adapter of ADAPTERS) {
    try { adapter.attach(); } catch { /* per-adapter resilience */ }
  }
}

/** @internal */
export function _detachAdapters(): void {
  for (const adapter of ADAPTERS) {
    try { adapter.detach(); } catch { /* noop */ }
  }
}
