/**
 * GraphView — dual-mode component relationship visualizer.
 *
 * ## Modes
 *
 * 1. **Active Path** (default): Shows the currently selected component and its
 *    direct ancestors in a compact vertical tree. Optimized for quick inspection.
 *
 * 2. **Full Canvas** (expandable): Shows all tracked components as an
 *    interactive node graph. Virtualized/capped at 500 nodes to prevent
 *    rendering lag on large trees (spec §3, Dual-Mode Visualizer).
 *
 * ## Node capping
 *
 * When the total tracked component count exceeds 500, only the first 500
 * are rendered and a "… N more components not shown" indicator is displayed.
 */

import { useState, useMemo, type ReactNode } from 'react';
import type { ComponentHistory } from '../../engine/instanceTracker';

// ── Constants ────────────────────────────────────────────────

const MAX_NODES = 500;

// ── Styles ───────────────────────────────────────────────────

const s = {
  container: { padding: '0', fontFamily: '"SF Mono", "Fira Code", monospace' },
  modeToggle: {
    display: 'flex', gap: '6px', marginBottom: '10px',
  },
  modeBtn: (active: boolean) => ({
    background: active ? '#7c4dff' : '#16213e',
    color: active ? '#fff' : '#aaa',
    border: active ? '1px solid #7c4dff' : '1px solid #333',
    borderRadius: '4px', padding: '4px 10px', fontSize: '11px',
    cursor: 'pointer', fontFamily: 'inherit',
  }),
  tree: { padding: '0', margin: 0, listStyle: 'none' as const },
  treeItem: (depth: number) => ({
    padding: '4px 0 4px ' + (depth * 20 + 8) + 'px',
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '11px', color: '#e0e0e0',
    borderLeft: '1px solid #2a2a3e', marginLeft: depth > 0 ? '0' : '0',
  }),
  nodeDot: (color: string) => ({
    width: '8px', height: '8px', borderRadius: '50%',
    background: color, display: 'inline-block', flexShrink: 0 as const,
  }),
  nodeName: { fontWeight: 'bold' as const, color: '#e0e0e0' },
  nodeCount: { color: '#888', fontSize: '10px', marginLeft: '4px' },
  canvas: {
    background: '#0d1117', borderRadius: '6px', padding: '12px',
    minHeight: '200px', maxHeight: '400px', overflow: 'auto' as const,
    display: 'flex', flexFlow: 'wrap' as const, gap: '6px',
    alignContent: 'flex-start' as const,
  },
  canvasNode: {
    background: '#16213e', border: '1px solid #2a2a3e',
    borderRadius: '6px', padding: '6px 10px', fontSize: '10px',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
    width: '140px', overflow: 'hidden' as const,
  },
  indicator: {
    color: '#666', fontStyle: 'italic', fontSize: '12px',
    padding: '8px 0', textAlign: 'center' as const,
  },
  none: { color: '#666', fontStyle: 'italic', fontSize: '12px' },
  edgeLegend: { color: '#555', fontSize: '10px', marginTop: '6px' },
};

// ── Helpers ──────────────────────────────────────────────────

const REASON_DOT_COLORS: Record<string, string> = {
  MOUNT: '#4fc3f7',
  STATE_CHANGE: '#ffb74d',
  PROP_VALUE_CHANGE: '#ff5252',
  PROP_REFERENCE_CHANGE: '#ff8a65',
  UNMEMOIZED_CALLBACK: '#ff6d00',
  CONTEXT_MUTATION: '#ce93d8',
  PARENT_RENDER: '#78909c',
};

function dotColor(reason?: string): string {
  return reason ? REASON_DOT_COLORS[reason] || '#78909c' : '#78909c';
}

// ── Active Path View ─────────────────────────────────────────

function ActivePathView({
  histories,
  selectedId,
  onSelect,
}: {
  histories: ComponentHistory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): ReactNode {
  // Build a simple parent→children map from instance ID path prefixes
  // Each instanceId has format "name|key|0.0.1" — the path is the last segment
  const selected = histories.find(h => h.instanceId === selectedId);
  if (!selected) {
    return (
      <div style={s.indicator}>
        Select a component in the Inspector tab to see its ancestor path.
      </div>
    );
  }

  // Build ancestor chain by matching path prefixes
  const selectedPath = selected.instanceId.split('|')[2]; // "0.0.1"
  const ancestors = histories.filter(h => {
    const path = h.instanceId.split('|')[2];
    if (!path) return false;
    return selectedPath?.startsWith(path) && h.instanceId !== selected.instanceId;
  });

  // Sort by path depth
  ancestors.sort((a, b) => {
    const dA = (a.instanceId.split('|')[2] || '').split('.').length;
    const dB = (b.instanceId.split('|')[2] || '').split('.').length;
    return dA - dB;
  });

  const chain = [...ancestors, selected];

  return (
    <div>
      <div style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase', marginBottom: '6px' }}>
        Active Path — {selected.componentName}
      </div>
      <ul style={s.tree}>
        {chain.map((h, i) => (
          <li key={h.instanceId} style={s.treeItem(i)} onClick={() => onSelect(h.instanceId)}>
            <span style={s.nodeDot(dotColor(h.lastRenderReason))} />
            <span style={s.nodeName}>{h.componentName}</span>
            <span style={s.nodeCount}>{h.renderCount}</span>
            {h.lastRenderWasted && <span style={{ color: '#ff5252', fontSize: '9px' }}>!</span>}
          </li>
        ))}
      </ul>
      <div style={s.edgeLegend}>
        ● colored by last render reason · bold = selected · ! = wasted
      </div>
    </div>
  );
}

// ── Full Canvas View ─────────────────────────────────────────

function FullCanvasView({
  histories,
  onSelect,
}: {
  histories: ComponentHistory[];
  onSelect: (id: string) => void;
}): ReactNode {
  const visible = useMemo(() => {
    // Apply 500-node cap
    if (histories.length <= MAX_NODES) return histories;
    return histories.slice(0, MAX_NODES);
  }, [histories]);

  const capped = histories.length > MAX_NODES;

  return (
    <div>
      <div style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase', marginBottom: '6px' }}>
        Component Graph ({histories.length} tracked
        {capped ? `, showing ${MAX_NODES})` : ')'}
      </div>
      <div style={s.canvas}>
        {visible.map(h => (
          <div key={h.instanceId} style={s.canvasNode} onClick={() => onSelect(h.instanceId)} title={h.instanceId}>
            <span style={s.nodeDot(dotColor(h.lastRenderReason))} />
            <span style={{ color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {h.componentName}
            </span>
            <span style={{ color: '#888', marginLeft: 'auto' }}>{h.renderCount}</span>
          </div>
        ))}
      </div>
      {capped && (
        <div style={s.indicator}>
          … {histories.length - MAX_NODES} more components not shown (500-node cap)
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

export type GraphMode = 'path' | 'canvas';

export interface GraphViewProps {
  histories: ComponentHistory[];
  /** Currently selected component instance ID (for path mode). */
  selectedInstanceId?: string | null;
  /** Called when a component node is clicked. */
  onSelectInstance?: (instanceId: string) => void;
}

export function GraphView({
  histories,
  selectedInstanceId,
  onSelectInstance,
}: GraphViewProps): ReactNode {
  const [mode, setMode] = useState<GraphMode>('canvas');

  const handleSelect = (id: string) => {
    onSelectInstance?.(id);
  };

  return (
    <div style={s.container}>
      {/* Mode toggle */}
      <div style={s.modeToggle}>
        <button style={s.modeBtn(mode === 'canvas')} onClick={() => setMode('canvas')}>
          Full Canvas
        </button>
        <button style={s.modeBtn(mode === 'path')} onClick={() => setMode('path')}>
          Active Path
        </button>
      </div>

      {/* Content */}
      {mode === 'canvas' ? (
        <FullCanvasView histories={histories} onSelect={handleSelect} />
      ) : (
        <ActivePathView
          histories={histories}
          selectedId={selectedInstanceId ?? null}
          onSelect={handleSelect}
        />
      )}
    </div>
  );
}
