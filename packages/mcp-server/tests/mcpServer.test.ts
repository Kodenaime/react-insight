import { describe, it, expect } from 'vitest';
import { maskValueFast } from 'react-insight/security';
import {
  executeTool,
  NO_ACTIVE_SESSION,
  DEFAULT_WASTED_RENDER_THRESHOLD,
} from '../src/tools';
import { createBridgeHandler } from '../src/bridge';
import type { BridgeSnapshot } from '../src/types';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature';

function makeSnapshot(): BridgeSnapshot {
  return {
    healthScore: {
      score: 72.5,
      metrics: [
        {
          name: 'wasted_render_ratio',
          label: 'Wasted Renders',
          value: 0.3,
          penalty: 9,
          weight: 30,
          capped: false,
        },
        {
          name: 'inline_allocation_count',
          label: 'Un-memoized Allocations',
          value: 1,
          penalty: 2,
          weight: 20,
          capped: false,
        },
      ],
    },
    report: {
      schemaVersion: '1.0',
      generatedAt: '2026-11-08T00:00:00.000Z',
      appHealthScore: 72.5,
      components: [
        {
          name: 'ExpenseTable',
          instanceId: 'ExpenseTable||0.0',
          renderCount: 10,
          wastedRenderRatio: 0.6,
          renderReasons: ['PROP_REFERENCE_CHANGE'],
          effectFindings: [
            { hookIndex: 0, status: 'RE_RAN', cause: JWT, changedDependencyIndices: [0] },
          ],
        },
        {
          name: 'App',
          instanceId: 'App||0.0',
          renderCount: 4,
          wastedRenderRatio: 0.1,
          renderReasons: ['MOUNT'],
          effectFindings: [],
        },
      ],
    },
  };
}

describe('get_health_score', () => {
  it('returns the score plus sub-metric breakdown', () => {
    const out = executeTool('get_health_score', {}, makeSnapshot()) as any;
    expect(out.score).toBe(72.5);
    expect(out.metrics).toHaveLength(2);
    expect(out.metrics[0].name).toBe('wasted_render_ratio');
  });
});

describe('get_component_diagnostics', () => {
  it('returns diagnostics for a named component', () => {
    const out = executeTool(
      'get_component_diagnostics',
      { name: 'ExpenseTable' },
      makeSnapshot(),
      { allowSensitive: true },
    ) as any;
    expect(out.found).toBe(true);
    expect(out.name).toBe('ExpenseTable');
    expect(out.wastedRenderRatio).toBe(0.6);
    expect(out.renderReasons).toEqual(['PROP_REFERENCE_CHANGE']);
    expect(out.effectFindings).toHaveLength(1);
  });

  it('returns a not-found result for an unknown component', () => {
    const out = executeTool(
      'get_component_diagnostics',
      { name: 'Nope' },
      makeSnapshot(),
      { allowSensitive: true },
    ) as any;
    expect(out.found).toBe(false);
    expect(out.name).toBe('Nope');
  });
});

describe('list_wasted_renders', () => {
  it('filters by the given threshold, sorted descending', () => {
    const out = executeTool('list_wasted_renders', { threshold: 0.5 }, makeSnapshot()) as any;
    expect(out.threshold).toBe(0.5);
    expect(out.count).toBe(1);
    expect(out.components[0].name).toBe('ExpenseTable');
  });

  it('uses the default threshold when omitted', () => {
    const out = executeTool('list_wasted_renders', {}, makeSnapshot()) as any;
    expect(out.threshold).toBe(DEFAULT_WASTED_RENDER_THRESHOLD);
    expect(out.count).toBe(1);
    expect(out.components[0].name).toBe('ExpenseTable');
  });
});

describe('get_masked_report', () => {
  it('returns the full current report', () => {
    const out = executeTool('get_masked_report', {}, makeSnapshot(), { allowSensitive: true }) as any;
    expect(out.schemaVersion).toBe('1.0');
    expect(out.components).toHaveLength(2);
  });
});

describe('allowSensitive gate', () => {
  it('restricts per-component detail by default', () => {
    const diag = executeTool('get_component_diagnostics', { name: 'ExpenseTable' }, makeSnapshot()) as any;
    expect(diag.restricted).toBe(true);

    const report = executeTool('get_masked_report', {}, makeSnapshot()) as any;
    expect(report.restricted).toBe(true);
  });

  it('keeps aggregate tools available by default', () => {
    const health = executeTool('get_health_score', {}, makeSnapshot()) as any;
    expect(health.score).toBe(72.5);

    const wasted = executeTool('list_wasted_renders', {}, makeSnapshot()) as any;
    expect(wasted.count).toBe(1);
  });
});

describe('masking gate', () => {
  it('masks a sensitive fixture value in the tool result', () => {
    const raw = executeTool('get_masked_report', {}, makeSnapshot(), { allowSensitive: true });
    const masked = maskValueFast(raw) as any;
    const cause = masked.components[0].effectFindings[0].cause;
    expect(cause).not.toBe(JWT);
    expect(cause).toContain('•');
  });
});

describe('no active session', () => {
  it('returns a structured no-session result instead of hanging or throwing', () => {
    const out = executeTool('get_health_score', {}, null) as any;
    expect(out.status).toBe(NO_ACTIVE_SESSION.status);
    expect(out.message).toContain('No browser session');
  });
});

describe('bridge token validation', () => {
  const token = 'a'.repeat(64);

  it('rejects a snapshot without a valid bridge token', () => {
    const bridge = createBridgeHandler({
      token,
      allowedOrigin: 'http://localhost:5173',
    });

    expect(
      bridge.submitSnapshot({
        token: undefined,
        origin: 'http://localhost:5173',
        snapshot: makeSnapshot(),
      }).ok,
    ).toBe(false);

    expect(
      bridge.submitSnapshot({
        token: 'wrong',
        origin: 'http://localhost:5173',
        snapshot: makeSnapshot(),
      }).ok,
    ).toBe(false);

    expect(bridge.getLatestSnapshot()).toBeNull();
  });

  it('accepts a snapshot with a valid token', () => {
    const bridge = createBridgeHandler({
      token,
      allowedOrigin: 'http://localhost:5173',
    });

    const result = bridge.submitSnapshot({
      token,
      origin: 'http://localhost:5173',
      snapshot: makeSnapshot(),
    });

    expect(result.ok).toBe(true);
    expect(bridge.getLatestSnapshot()).not.toBeNull();
  });
});
