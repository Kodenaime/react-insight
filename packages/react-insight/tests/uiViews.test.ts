/**
 * UI Views — tests using real HTML rendering via react-dom/server.
 *
 * Renders components to static HTML markup and asserts content
 * in the output. This tests real component output without needing
 * a full browser environment.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RenderInspectorView } from '../src/ui/views/RenderInspectorView';
import { EffectTimelineView } from '../src/ui/views/EffectTimelineView';
import { CodeDiffView } from '../src/ui/views/CodeDiffView';
import type { ComponentHistory } from '../src/engine/instanceTracker';
import type { EffectAnalysis } from '../src/engine/effectAnalyzer';

function mockHistory(id: string, overrides: Partial<ComponentHistory> = {}): ComponentHistory {
  return {
    instanceId: id, renderCount: 1, componentName: id.split('||')[0],
    lastRenderReason: 'MOUNT', lastRenderWasted: false, ...overrides,
  };
}

function mockEffectAnalysis(overrides: Partial<EffectAnalysis> = {}): EffectAnalysis {
  return {
    instanceId: 'Comp||0', componentName: 'Comp', effects: [],
    hasUnboundedEffect: false, isOffscreenBound: false, ...overrides,
  };
}

function html(el: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(el);
}

describe('RenderInspectorView', () => {
  it('renders empty state when no histories', () => {
    expect(html(createElement(RenderInspectorView, { histories: [] })))
      .toContain('No component data captured');
  });

  it('renders component names and render counts from mock telemetry', () => {
    const h = [
      mockHistory('App||0', { renderCount: 5, lastRenderReason: 'STATE_CHANGE' }),
      mockHistory('Header||1', { renderCount: 3, lastRenderReason: 'PARENT_RENDER', lastRenderWasted: true }),
      mockHistory('ExpenseTable||2', { renderCount: 10, lastRenderReason: 'PROP_REFERENCE_CHANGE', lastRenderWasted: true }),
    ];
    const out = html(createElement(RenderInspectorView, { histories: h }));
    expect(out).toContain('App');
    expect(out).toContain('Header');
    expect(out).toContain('ExpenseTable');
    expect(out).toContain('STATE_CHANGE');
    expect(out).toContain('PARENT_RENDER');
    expect(out).toContain('PROP_REFERENCE_CHANGE');
    expect(out).toContain('WASTED');
  });

  it('renders component names, render counts, and reason badges', () => {
    const h = [
      mockHistory('App||0', { renderCount: 5, lastRenderReason: 'STATE_CHANGE' }),
      mockHistory('Header||1', { renderCount: 3, lastRenderReason: 'PARENT_RENDER', lastRenderWasted: true }),
      mockHistory('ExpenseTable||2', { renderCount: 10, lastRenderReason: 'PROP_REFERENCE_CHANGE', lastRenderWasted: true }),
    ];
    const out = html(createElement(RenderInspectorView, { histories: h }));
    expect(out).toContain('App');
    expect(out).toContain('Header');
    expect(out).toContain('ExpenseTable');
    expect(out).toContain('STATE_CHANGE');
    expect(out).toContain('PARENT_RENDER');
    expect(out).toContain('PROP_REFERENCE_CHANGE');
    expect(out).toContain('WASTED');
  });

  it('shows summary stats — total renders and component count', () => {
    const h = [
      mockHistory('A||0', { renderCount: 5, lastRenderReason: 'STATE_CHANGE' }),
      mockHistory('B||1', { renderCount: 3, lastRenderReason: 'MOUNT' }),
    ];
    const out = html(createElement(RenderInspectorView, { histories: h }));
    expect(out).toContain('Total Renders');
    expect(out).toContain('Components');
    expect(out).toContain('Wasted');
  });
});

describe('EffectTimelineView', () => {
  it('renders empty state when no effects', () => {
    expect(html(createElement(EffectTimelineView, { effectAnalyses: [] })))
      .toContain('No effect data captured');
  });

  it('renders effect entries with status badges', () => {
    const a = [
      mockEffectAnalysis({ instanceId: 'App||0', componentName: 'App',
        effects: [{ effectHookIndex: 0, status: 'FIRST_MOUNT', wasted: false, cause: 'Initial mount effect', changedDeps: [], deps: [], prevDeps: null }],
      }),
      mockEffectAnalysis({ instanceId: 'List||1', componentName: 'List',
        effects: [{ effectHookIndex: 0, status: 'RE_RAN', wasted: true, cause: 'deps[0] changed', changedDeps: [{ index: 0, changeType: 'value', prev: 'a', current: 'b' }], deps: ['b'], prevDeps: ['a'] }],
      }),
    ];
    const out = html(createElement(EffectTimelineView, { effectAnalyses: a }));
    expect(out).toContain('App');
    expect(out).toContain('List');
    expect(out).toContain('FIRST_MOUNT');
    expect(out).toContain('RE_RAN');
    expect(out).toContain('deps[0]');
    expect(out).toContain('Initial mount effect');
  });

  it('displays unbounded effect warning', () => {
    const a = [mockEffectAnalysis({
      effects: [{ effectHookIndex: 0, status: 'UNBOUNDED', wasted: true, cause: 'No dependency array', changedDeps: [], deps: null, prevDeps: null }],
    })];
    const out = html(createElement(EffectTimelineView, { effectAnalyses: a }));
    expect(out).toContain('UNBOUNDED');
    expect(out).toContain('No dependency array');
  });
});

describe('CodeDiffView', () => {
  it('renders empty state when no fixes', () => {
    expect(html(createElement(CodeDiffView, { histories: [] })))
      .toContain('No refactoring suggestions');
  });

  it('generates useCallback fix for UNMEMOIZED_CALLBACK', () => {
    const out = html(createElement(CodeDiffView, {
      histories: [mockHistory('Button||0', { lastRenderReason: 'UNMEMOIZED_CALLBACK', lastRenderWasted: true })],
    }));
    expect(out).toContain('useCallback');
    expect(out).toContain('Button');
    expect(out).toContain('Inline callback');
  });

  it('generates useMemo fix for PROP_REFERENCE_CHANGE', () => {
    const out = html(createElement(CodeDiffView, {
      histories: [mockHistory('ConfigDisplay||0', { lastRenderReason: 'PROP_REFERENCE_CHANGE', lastRenderWasted: true })],
    }));
    expect(out).toContain('useMemo');
    expect(out).toContain('ConfigDisplay');
    expect(out).toContain('Recreated object');
  });

  it('generates multiple fixes for different components', () => {
    const out = html(createElement(CodeDiffView, {
      histories: [
        mockHistory('Btn||0', { lastRenderReason: 'UNMEMOIZED_CALLBACK', lastRenderWasted: true }),
        mockHistory('Cfg||1', { lastRenderReason: 'PROP_REFERENCE_CHANGE', lastRenderWasted: true }),
      ],
    }));
    expect(out).toContain('useCallback');
    expect(out).toContain('useMemo');
    expect(out).toContain('Btn');
    expect(out).toContain('Cfg');
    expect(out).toContain('Suggested Fixes');
  });
});
