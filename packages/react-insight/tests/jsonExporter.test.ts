import { describe, it, expect } from 'vitest';
import { buildDiagnosticReport } from '../src/export/jsonExporter';
import { SCHEMA_VERSION } from '../src/export/schema';
import type { ComponentHistory } from '../src/engine/instanceTracker';
import type { HealthScore } from '../src/engine/healthEngine';

function makeHealthScore(score = 87.5): HealthScore {
  return {
    score,
    metrics: [],
    recommendations: [],
    weightsUsed: {
      wastedRenderWeight: 30,
      propDepthWeight: 20,
      inlineAllocationWeight: 20,
      contextFanoutWeight: 15,
      effectChurnWeight: 15,
      propDepthThreshold: 3,
      contextFanoutThreshold: 5,
    },
  };
}

function makeHistory(overrides: Partial<ComponentHistory> = {}): ComponentHistory {
  return {
    instanceId: 'Comp|k|0.0',
    componentName: 'Comp',
    renderCount: 4,
    wastedRenderCount: 2,
    lastRenderReason: 'PROP_REFERENCE_CHANGE',
    lastRenderWasted: true,
    ...overrides,
  };
}

describe('buildDiagnosticReport', () => {
  it('produces a schema-conformant report', () => {
    const report = buildDiagnosticReport([], makeHealthScore(100));

    expect(report.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof report.generatedAt).toBe('string');
    expect(new Date(report.generatedAt).toString()).not.toBe('Invalid Date');
    expect(report.appHealthScore).toBe(100);
    expect(Array.isArray(report.components)).toBe(true);
  });

  it('maps component histories into component diagnostics', () => {
    const report = buildDiagnosticReport([makeHistory()], makeHealthScore(50));

    expect(report.components).toHaveLength(1);
    const c = report.components[0];
    expect(c.name).toBe('Comp');
    expect(c.instanceId).toBe('Comp|k|0.0');
    expect(c.renderCount).toBe(4);
    expect(c.wastedRenderRatio).toBe(0.5);
    expect(c.renderReasons).toEqual(['PROP_REFERENCE_CHANGE']);
    expect(c.effectFindings).toEqual([]);
  });

  it('computes wastedRenderRatio as wastedRenderCount / renderCount', () => {
    const report = buildDiagnosticReport(
      [makeHistory({ renderCount: 10, wastedRenderCount: 3 })],
      makeHealthScore(),
    );

    expect(report.components[0].wastedRenderRatio).toBe(0.3);
  });

  it('yields 0 ratio and empty reasons for a component with no history', () => {
    const report = buildDiagnosticReport(
      [makeHistory({ renderCount: 0, wastedRenderCount: 0, lastRenderReason: undefined })],
      makeHealthScore(),
    );

    expect(report.components[0].wastedRenderRatio).toBe(0);
    expect(report.components[0].renderReasons).toEqual([]);
  });

  it('maps effect findings from the last effect analysis', () => {
    const history = makeHistory({
      lastEffectAnalysis: {
        instanceId: 'Comp|k|0.0',
        componentName: 'Comp',
        hasUnboundedEffect: false,
        isOffscreenBound: false,
        effects: [
          {
            effectHookIndex: 0,
            status: 'RE_RAN',
            wasted: true,
            cause: 'deps[0] value changed ("a" → "b")',
            changedDeps: [{ index: 0, changeType: 'value', prev: 'a', current: 'b' }],
            deps: ['b'],
            prevDeps: ['a'],
          },
        ],
      },
    });

    const report = buildDiagnosticReport([history], makeHealthScore());

    expect(report.components[0].effectFindings).toEqual([
      {
        hookIndex: 0,
        status: 'RE_RAN',
        cause: 'deps[0] value changed ("a" → "b")',
        changedDependencyIndices: [0],
      },
    ]);
  });

  it('routes sensitive values through the masker before serialization', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature';
    const history = makeHistory({
      lastEffectAnalysis: {
        instanceId: 'Comp|k|0.0',
        componentName: 'Comp',
        hasUnboundedEffect: false,
        isOffscreenBound: false,
        effects: [
          {
            effectHookIndex: 0,
            status: 'FIRST_MOUNT',
            wasted: false,
            cause: jwt,
            changedDeps: [],
            deps: [],
            prevDeps: null,
          },
        ],
      },
    });

    const report = buildDiagnosticReport([history], makeHealthScore());

    const cause = report.components[0].effectFindings[0].cause;
    expect(cause).not.toBe(jwt);
    expect(cause).toContain('•');
  });
});
