/**
 * OverlayDrawer — floating, dockable, dark-mode UI overlay with tab views.
 *
 * Rendered via a React Portal into document.body so it sits above the
 * host application regardless of DOM nesting.
 *
 * ## Tabs
 * - Overview — health score + runtime metrics
 * - Inspector — per-component render reason breakdown
 * - Effects — effect execution timeline
 * - Fixes — before/after code diff suggestions
 * - Graph — dual-mode component relationship visualizer
 *
 * Each tab pulls live telemetry from ReactInsightEngine.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ReactInsightEngine } from '../engine/ReactInsightEngine';
import { getAllHistories } from '../engine/instanceTracker';
import type { ComponentHistory } from '../engine/instanceTracker';
import type { EffectAnalysis } from '../engine/effectAnalyzer';
import { RenderInspectorView } from './views/RenderInspectorView';
import { EffectTimelineView } from './views/EffectTimelineView';
import { CodeDiffView } from './views/CodeDiffView';
import { GraphView } from './views/GraphView';
import { generateAndCopy } from '../export/markdownExporter';

// ── Types ────────────────────────────────────────────────────

export type DockPosition = 'bottom' | 'side';

export interface OverlayDrawerProps {
  defaultVisible?: boolean;
  defaultDock?: DockPosition;
}

type TabId = 'overview' | 'inspector' | 'effects' | 'fixes' | 'graph';

interface TabDef {
  id: TabId;
  label: string;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'effects', label: 'Effects' },
  { id: 'fixes', label: 'Fixes' },
  { id: 'graph', label: 'Graph' },
];

// ── Telemetry ────────────────────────────────────────────────

interface TelemetrySnapshot {
  renderCount: number;
  componentCount: number;
  healthScore: number;
  adapterWarnings: number;
  histories: ComponentHistory[];
  effectAnalyses: EffectAnalysis[];
}

function takeSnapshot(): TelemetrySnapshot {
  const histories = getAllHistories();
  const healthScore = ReactInsightEngine.getHealthScore?.() ?? { score: 100 };
  const warnings = ReactInsightEngine.getAdapterWarnings?.() ?? [];

  return {
    renderCount: histories.reduce((sum, h) => sum + (h.renderCount || 0), 0),
    componentCount: histories.length,
    healthScore: healthScore.score,
    adapterWarnings: warnings.length,
    histories,
    effectAnalyses: histories
      .map(h => h.lastEffectAnalysis)
      .filter((ea): ea is EffectAnalysis => ea !== undefined),
  };
}

// ── Inline Styles ────────────────────────────────────────────

const styles = {
  trigger: {
    position: 'fixed' as const, bottom: '12px', right: '12px',
    zIndex: 2147483647, background: '#1a1a2e', color: '#e0e0e0',
    border: '1px solid #333', borderRadius: '8px', padding: '8px 14px',
    cursor: 'pointer', fontFamily: '"SF Mono", "Fira Code", monospace',
    fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.4)', userSelect: 'none' as const,
  },
  badge: (bg: string, fg: string) => ({
    background: bg, color: fg, borderRadius: '10px', padding: '0 6px',
    fontSize: '11px', fontWeight: 'bold' as const, lineHeight: '18px',
  }),
  warningBadge: {
    background: '#ff6d00', color: '#fff', borderRadius: '10px',
    padding: '0 6px', fontSize: '11px', fontWeight: 'bold' as const, lineHeight: '18px',
  },
  drawer: {
    position: 'fixed' as const, zIndex: 2147483646, background: '#1a1a2e',
    color: '#e0e0e0', border: '1px solid #333',
    fontFamily: '"SF Mono", "Fira Code", monospace', fontSize: '13px',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.5)', overflow: 'auto' as const,
  },
  drawerBottom: { bottom: '0', left: '0', right: '0', height: '320px', borderTopLeftRadius: '12px', borderTopRightRadius: '12px' },
  drawerSide: { top: '0', right: '0', width: '400px', height: '100vh', borderLeft: '1px solid #333' },
  header: { padding: '8px 14px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontWeight: 'bold' as const, fontSize: '14px' },
  tabsRow: { display: 'flex', borderBottom: '1px solid #2a2a3e', background: '#16213e' },
  tab: (active: boolean) => ({
    padding: '8px 14px', fontSize: '12px', cursor: 'pointer',
    borderBottom: active ? '2px solid #7c4dff' : '2px solid transparent',
    color: active ? '#e0e0e0' : '#888',
    fontWeight: (active ? 'bold' : 'normal') as 'bold' | 'normal',
    background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
    fontFamily: 'inherit',
  }),
  content: { padding: '10px 14px', overflow: 'auto' as const, height: 'calc(100% - 90px)' },
  section: { padding: '10px 14px', borderBottom: '1px solid #2a2a3e' },
  label: { color: '#888', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '4px' },
  value: { color: '#00e676', fontSize: '13px' },
  metricRow: { display: 'flex', justifyContent: 'space-between', padding: '4px 0' },
  closeBtn: { background: 'none', border: '1px solid #555', color: '#aaa', borderRadius: '4px', cursor: 'pointer', padding: '2px 8px', fontSize: '12px' },
  dockBtn: { background: 'none', border: '1px solid #555', color: '#aaa', borderRadius: '4px', cursor: 'pointer', padding: '2px 8px', fontSize: '12px', marginLeft: '6px' },
  fallback: { position: 'fixed' as const, bottom: '12px', right: '12px', zIndex: 2147483646, background: '#1a1a2e', color: '#ff5252', border: '1px solid #ff5252', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', fontFamily: '"SF Mono", "Fira Code", monospace' },
};

// ── Tab content ──────────────────────────────────────────────

function OverviewTab({ t, onCopyMarkdown }: { t: TelemetrySnapshot; onCopyMarkdown: () => void }) {
  const healthColor = t.healthScore >= 80 ? '#00c853' : t.healthScore >= 50 ? '#ff6d00' : '#ff5252';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopyMarkdown();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div style={styles.section}>
        <div style={styles.label}>Architecture Health</div>
        <div style={{ ...styles.value, fontSize: '24px', color: healthColor }}>
          {t.healthScore}<span style={{ fontSize: '14px', color: '#888' }}>/100</span>
        </div>
      </div>
      <div style={styles.section}>
        <div style={styles.label}>Runtime Metrics</div>
        <div style={styles.metricRow}><span style={{ color: '#aaa' }}>Components Tracked</span><span style={styles.value}>{t.componentCount}</span></div>
        <div style={styles.metricRow}><span style={{ color: '#aaa' }}>Total Renders</span><span style={styles.value}>{t.renderCount}</span></div>
        <div style={styles.metricRow}>
          <span style={{ color: '#aaa' }}>Adapter Warnings</span>
          <span style={{ ...styles.value, color: t.adapterWarnings > 0 ? '#ff6d00' : '#00e676' }}>{t.adapterWarnings}</span>
        </div>
      </div>
      <div style={{ ...styles.section, borderBottom: 'none' }}>
        <div style={styles.label}>Details</div>
        <div style={{ color: '#666', fontSize: '12px', fontStyle: 'italic' }}>
          Select the Inspector, Effects, or Fixes tabs for detailed analysis.
        </div>
        <button
          onClick={handleCopy}
          style={{
            background: copied ? '#00c853' : '#7c4dff',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            padding: '6px 12px',
            fontSize: '12px',
            cursor: 'pointer',
            marginTop: '8px',
            fontFamily: 'inherit',
          }}
        >
          {copied ? 'Copied!' : 'Copy PR Summary'}
        </button>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

export function OverlayDrawer({
  defaultVisible = true,
  defaultDock = 'bottom',
}: OverlayDrawerProps): ReactNode {
  const [visible, setVisible] = useState(defaultVisible);
  const [docked, setDocked] = useState<DockPosition>(defaultDock);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>(() => takeSnapshot());

  useEffect(() => {
    const interval = setInterval(() => setTelemetry(takeSnapshot()), 2000);
    return () => clearInterval(interval);
  }, []);

  const toggle = useCallback(() => setVisible(v => !v), []);
  const cycleDock = useCallback(() => setDocked(d => d === 'bottom' ? 'side' : 'bottom'), []);
  const handleCopyMarkdown = useCallback(() => {
    generateAndCopy(telemetry.histories, { score: telemetry.healthScore } as any);
  }, [telemetry]);

  const healthColor = telemetry.healthScore >= 80 ? '#00c853'
    : telemetry.healthScore >= 50 ? '#ff6d00' : '#ff5252';

  const portalContainer = typeof document !== 'undefined' ? document.body : null;
  if (!portalContainer) return null;

  return (
    <>
      <button onClick={toggle} style={styles.trigger}
        aria-label={visible ? 'Close React Insight' : 'Open React Insight'} title="React Insight">
        <span style={{ color: '#7c4dff', fontWeight: 'bold' }}>RI</span>
        <span>{telemetry.renderCount} renders</span>
        <span style={styles.badge(healthColor, healthColor === '#00c853' ? '#000' : '#fff')}>{telemetry.healthScore}</span>
        {telemetry.adapterWarnings > 0 && <span style={styles.warningBadge}>{telemetry.adapterWarnings}</span>}
      </button>

      {visible && createPortal(
        <div style={{ ...styles.drawer, ...(docked === 'bottom' ? styles.drawerBottom : styles.drawerSide) }}
          role="dialog" aria-label="React Insight Dashboard">
          <div style={styles.header}>
            <span style={styles.title}>⚡ React Insight</span>
            <div>
              <button onClick={cycleDock} style={styles.dockBtn}>{docked === 'bottom' ? 'Side' : 'Bottom'}</button>
              <button onClick={toggle} style={styles.closeBtn}>✕</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={styles.tabsRow}>
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={styles.tab(activeTab === tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={styles.content}>
            {activeTab === 'overview' && <OverviewTab t={telemetry} onCopyMarkdown={handleCopyMarkdown} />}
            {activeTab === 'inspector' && (
              <RenderInspectorView histories={telemetry.histories} />
            )}
            {activeTab === 'effects' && (
              <EffectTimelineView effectAnalyses={telemetry.effectAnalyses} />
            )}
            {activeTab === 'fixes' && (
              <CodeDiffView histories={telemetry.histories} />
            )}
            {activeTab === 'graph' && (
              <GraphView histories={telemetry.histories} />
            )}
          </div>
        </div>,
        portalContainer,
      )}
    </>
  );
}

export function OverlayCrashFallback(): ReactNode {
  if (typeof document === 'undefined') return null;
  return <div style={styles.fallback}>⚡ React Insight overlay unavailable (error caught)</div>;
}
