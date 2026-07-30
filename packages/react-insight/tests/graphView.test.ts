/**
 * GraphView — test suite.
 *
 * Verifies component rendering with up to 550 mock nodes to confirm
 * the 500-node capping behavior.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GraphView } from '../src/ui/views/GraphView';
import type { ComponentHistory } from '../src/engine/instanceTracker';

function mock(id: string, overrides: Partial<ComponentHistory> = {}): ComponentHistory {
  return {
    instanceId: id, renderCount: 1, componentName: id.split('||')[0],
    lastRenderReason: 'MOUNT', lastRenderWasted: false, ...overrides,
  };
}

function html(el: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(el);
}

describe('GraphView', () => {
  it('renders with minimal histories', () => {
    const out = html(createElement(GraphView, { histories: [mock('App||0')] }));
    expect(out).toContain('App');
    expect(out).toContain('Full Canvas');
  });

  it('caps at 500 nodes and shows overflow indicator', () => {
    const histories: ComponentHistory[] = [];
    for (let i = 0; i < 550; i++) {
      histories.push(mock(`Comp${i}||${i}`));
    }
    const out = html(createElement(GraphView, { histories }));
    expect(out).toContain('500-node cap');
    expect(out).toContain('50 more');
  });

  it('does not show cap indicator at 300 nodes', () => {
    const histories: ComponentHistory[] = Array.from({ length: 300 }, (_, i) =>
      mock(`C${i}||${i}`),
    );
    const out = html(createElement(GraphView, { histories }));
    expect(out).not.toContain('500-node cap');
  });

  it('shows mode toggle buttons', () => {
    const out = html(createElement(GraphView, { histories: [mock('A||0')] }));
    expect(out).toContain('Full Canvas');
    expect(out).toContain('Active Path');
  });
});
