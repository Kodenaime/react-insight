/**
 * EffectTimelineView — timeline list of executed useEffect hooks.
 *
 * Shows each effect's dependency array, which indices changed, and
 * the classified trigger cause. Highlights StrictMode double-invocation
 * patterns and unbounded effects.
 */

import type { ReactNode } from 'react';
import type { EffectAnalysis } from '../../engine/effectAnalyzer';

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
  card: {
    background: '#16213e',
    borderRadius: '6px',
    padding: '10px 12px',
    marginBottom: '8px',
    fontSize: '12px',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  effectId: {
    color: '#ce93d8',
    fontWeight: 'bold' as const,
    fontSize: '11px',
  },
  statusBadge: (color: string) => ({
    background: color,
    color: '#000',
    borderRadius: '4px',
    padding: '1px 6px',
    fontSize: '10px',
    fontWeight: 'bold' as const,
  }),
  causeText: {
    color: '#e0e0e0',
    fontSize: '11px',
    lineHeight: '1.5',
    marginBottom: '6px',
  },
  depsContainer: {
    background: '#0f3460',
    borderRadius: '4px',
    padding: '6px 8px',
    fontFamily: '"SF Mono", "Fira Code", monospace',
    fontSize: '10px',
    lineHeight: '1.6',
    maxHeight: '80px',
    overflow: 'auto' as const,
  },
  depChanged: {
    color: '#ff5252',
    fontWeight: 'bold' as const,
  },
  depUnchanged: {
    color: '#888',
  },
  depArrow: {
    color: '#ff8a65',
    margin: '0 4px',
  },
  none: {
    color: '#666',
    fontStyle: 'italic',
    fontSize: '12px',
  },
  expandBtn: {
    background: 'none',
    border: '1px solid #444',
    color: '#888',
    borderRadius: '4px',
    padding: '1px 6px',
    fontSize: '10px',
    cursor: 'pointer',
    marginTop: '4px',
  },
};

const STATUS_COLORS: Record<string, string> = {
  FIRST_MOUNT: '#4fc3f7',
  RE_RAN: '#ffb74d',
  UNBOUNDED: '#ff5252',
  STRICT_MODE_DOUBLE_INVOCATION: '#ff8a65',
  OFFSCREEN_REAPPEARANCE: '#ce93d8',
};

// ── Component ────────────────────────────────────────────────

export interface EffectTimelineViewProps {
  /** All effect analyses from tracked components. */
  effectAnalyses: EffectAnalysis[];
}

export function EffectTimelineView({
  effectAnalyses,
}: EffectTimelineViewProps): ReactNode {
  const allEffects = effectAnalyses.flatMap(ea =>
    ea.effects.map(e => ({ ...e, componentName: ea.componentName })),
  );

  if (allEffects.length === 0) {
    return (
      <div style={s.container}>
        <div style={s.none}>No effect data captured yet. Effects will appear as components mount and update.</div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <div style={s.header}>Effect Execution Timeline ({allEffects.length} entries)</div>
      {allEffects.map((effect, i) => {
        const statusColor = STATUS_COLORS[effect.status] || '#78909c';
        return (
          <div key={i} style={s.card}>
            {/* Header row */}
            <div style={s.cardHeader}>
              <span style={s.effectId}>
                {effect.componentName} · Hook #{effect.effectHookIndex}
              </span>
              <span style={s.statusBadge(statusColor)}>{effect.status}</span>
            </div>

            {/* Cause */}
            <div style={s.causeText}>{effect.cause}</div>

            {/* Changed deps */}
            {effect.changedDeps.length > 0 && (
              <div style={{ marginBottom: '4px' }}>
                <span style={{ color: '#ff5252', fontSize: '10px' }}>
                  Changed deps: {effect.changedDeps.map(d => `deps[${d.index}] (${d.changeType})`).join(', ')}
                </span>
              </div>
            )}

            {/* Deps display */}
            <div style={s.depsContainer}>
              {effect.status === 'UNBOUNDED' ? (
                <span style={{ color: '#ff5252' }}>No dependency array — runs on every render</span>
              ) : effect.deps && effect.deps.length > 0 ? (
                <div>
                  <span style={{ color: '#888' }}>deps: </span>
                  {effect.deps.map((dep, di) => {
                    const changed = effect.changedDeps.some(cd => cd.index === di);
                    return (
                      <span key={di} style={changed ? s.depChanged : s.depUnchanged}>
                        {changed && effect.prevDeps
                          ? `${JSON.stringify(effect.prevDeps[di] ?? 'undefined')} → `
                          : ''}
                        {JSON.stringify(dep ?? 'undefined')}
                        {di < effect.deps!.length - 1 ? ', ' : ''}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <span style={{ color: '#888' }}>deps: []</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
