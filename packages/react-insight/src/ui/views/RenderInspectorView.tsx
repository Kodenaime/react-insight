/**
 * RenderInspectorView — displays active component inspect details.
 *
 * Shows each tracked component's render count, wasted render ratio,
 * last render reason, and property diff breakdowns when a component
 * is selected for inspection.
 */

import { useState, type ReactNode } from 'react';
import type { ComponentHistory } from '../../engine/instanceTracker';

// ── Styles ───────────────────────────────────────────────────

const s = {
  container: {
    padding: '0',
  },
  header: {
    color: '#e0e0e0',
    fontWeight: 'bold' as const,
    fontSize: '13px',
    marginBottom: '8px',
  },
  summaryRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '12px',
    flexWrap: 'wrap' as const,
  },
  statBox: {
    background: '#16213e',
    borderRadius: '6px',
    padding: '8px 12px',
    flex: '1 0 auto',
    minWidth: '80px',
  },
  statLabel: {
    color: '#888',
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  statValue: {
    color: '#00e676',
    fontSize: '18px',
    fontWeight: 'bold' as const,
    marginTop: '2px',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  listItem: {
    padding: '8px 12px',
    borderBottom: '1px solid #2a2a3e',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '12px',
  },
  listItemHover: {
    background: '#1a1a3e',
  },
  componentName: {
    color: '#e0e0e0',
    fontWeight: 'bold' as const,
    fontSize: '12px',
  },
  badge: (color: string) => ({
    background: color,
    color: '#000',
    borderRadius: '4px',
    padding: '1px 6px',
    fontSize: '10px',
    fontWeight: 'bold' as const,
  }),
  detailPanel: {
    background: '#0f3460',
    borderRadius: '6px',
    padding: '10px 12px',
    marginTop: '8px',
    fontSize: '12px',
  },
  detailRow: {
    padding: '3px 0',
    display: 'flex',
    justifyContent: 'space-between',
  },
  diffLine: {
    padding: '2px 0',
    fontFamily: '"SF Mono", "Fira Code", monospace',
    fontSize: '11px',
    lineHeight: '1.5',
  },
  diffPrev: {
    color: '#ff5252',
  },
  diffNext: {
    color: '#00e676',
  },
  none: {
    color: '#666',
    fontStyle: 'italic',
    fontSize: '12px',
  },
};

// ── Helpers ──────────────────────────────────────────────────

const REASON_COLORS: Record<string, string> = {
  MOUNT: '#4fc3f7',
  STATE_CHANGE: '#ffb74d',
  PROP_VALUE_CHANGE: '#ff5252',
  PROP_REFERENCE_CHANGE: '#ff8a65',
  UNMEMOIZED_CALLBACK: '#ff6d00',
  CONTEXT_MUTATION: '#ce93d8',
  PARENT_RENDER: '#78909c',
};

function formatReasonBadge(reason?: string): ReactNode {
  const color = reason ? REASON_COLORS[reason] || '#78909c' : '#78909c';
  return <span style={s.badge(color)}>{reason || 'UNKNOWN'}</span>;
}

// ── Component ────────────────────────────────────────────────

export interface RenderInspectorViewProps {
  histories: ComponentHistory[];
  /** Called when user clicks "Jump to Code" (Phase 5). */
  onJumpToCode?: (instanceId: string) => void;
}

export function RenderInspectorView({
  histories,
  onJumpToCode,
}: RenderInspectorViewProps): ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = histories.find(h => h.instanceId === selectedId);

  const totalRenders = histories.reduce((sum, h) => sum + h.renderCount, 0);
  const wastedCount = histories.filter(h => h.lastRenderWasted).length;
  const wasteRatio = totalRenders > 0
    ? ((wastedCount / histories.length) * 100).toFixed(0)
    : '0';

  return (
    <div style={s.container}>
      {/* Summary stats */}
      <div style={s.summaryRow}>
        <div style={s.statBox}>
          <div style={s.statLabel}>Components</div>
          <div style={s.statValue}>{histories.length}</div>
        </div>
        <div style={s.statBox}>
          <div style={s.statLabel}>Total Renders</div>
          <div style={s.statValue}>{totalRenders}</div>
        </div>
        <div style={s.statBox}>
          <div style={s.statLabel}>Wasted %</div>
          <div style={{ ...s.statValue, color: Number(wasteRatio) > 50 ? '#ff5252' : '#00e676' }}>
            {wasteRatio}%
          </div>
        </div>
      </div>

      {/* Component list */}
      {histories.length === 0 ? (
        <div style={s.none}>No component data captured yet. Interact with your app to generate telemetry.</div>
      ) : (
        <ul style={s.list}>
          {histories.map(h => (
            <li
              key={h.instanceId}
              style={s.listItem}
              onClick={() => setSelectedId(selectedId === h.instanceId ? null : h.instanceId)}
            >
              <span style={s.componentName}>{h.componentName}</span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: '#888', fontSize: '11px' }}>{h.renderCount}</span>
                {formatReasonBadge(h.lastRenderReason)}
                {h.lastRenderWasted && <span style={{ color: '#ff5252', fontSize: '10px' }}>WASTED</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Detail panel for selected component */}
      {selected && (
        <div style={s.detailPanel}>
          <div style={{ fontWeight: 'bold', marginBottom: '6px', fontSize: '13px', color: '#e0e0e0' }}>
            {selected.componentName}
            <span style={{ color: '#888', fontSize: '11px', marginLeft: '6px' }}>{selected.instanceId}</span>
          </div>

          <div style={s.detailRow}>
            <span style={{ color: '#888' }}>Render Count</span>
            <span style={{ color: '#00e676' }}>{selected.renderCount}</span>
          </div>
          <div style={s.detailRow}>
            <span style={{ color: '#888' }}>Last Reason</span>
            <span>{formatReasonBadge(selected.lastRenderReason)}</span>
          </div>
          <div style={s.detailRow}>
            <span style={{ color: '#888' }}>Wasted Render</span>
            <span style={{ color: selected.lastRenderWasted ? '#ff5252' : '#00e676' }}>
              {selected.lastRenderWasted ? 'Yes' : 'No'}
            </span>
          </div>

          {/* Prop diff details from render inspector (stored in lastProps) */}
          {typeof selected.lastProps === 'object' && selected.lastProps !== null && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase', marginBottom: '4px' }}>
                Props Snapshot
              </div>
              <pre style={{
                margin: 0,
                fontSize: '11px',
                color: '#e0e0e0',
                maxHeight: '100px',
                overflow: 'auto',
                background: '#16213e',
                padding: '6px',
                borderRadius: '4px',
              }}>
                {JSON.stringify(selected.lastProps, null, 2).slice(0, 300)}
              </pre>
            </div>
          )}

          {/* Effect analysis summary */}
          {selected.lastEffectAnalysis && selected.lastEffectAnalysis.effects.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase', marginBottom: '4px' }}>
                Effects ({selected.lastEffectAnalysis.effects.length})
              </div>
              {selected.lastEffectAnalysis.effects.slice(0, 3).map((eff, i) => (
                <div key={i} style={s.detailRow}>
                  <span style={{ color: '#e0e0e0' }}>#{eff.effectHookIndex}</span>
                  <span style={{ color: '#ce93d8', fontSize: '10px' }}>{eff.status}</span>
                </div>
              ))}
            </div>
          )}

          {onJumpToCode && (
            <div style={{ marginTop: '8px', textAlign: 'right' }}>
              <button
                onClick={() => onJumpToCode(selected.instanceId)}
                style={{
                  background: 'none',
                  border: '1px solid #7c4dff',
                  color: '#7c4dff',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                Jump to Code
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
