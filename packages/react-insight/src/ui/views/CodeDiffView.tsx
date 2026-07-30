/**
 * CodeDiffView — before/after refactoring code diff generator.
 *
 * Takes a detected unstable reference (e.g., inline callback, recreated
 * object) and generates copy-paste ready useCallback or useMemo fixes.
 *
 * ## Output format
 *
 * ```tsx
 * // Before
 * <ExpenseRow onItemSelect={() => select(item.id)} />
 *
 * // After
 * const onItemSelect = useCallback((id) => select(id), []);
 * <ExpenseRow onItemSelect={onItemSelect} />
 * ```
 */

import { useState, type ReactNode } from 'react';
import type { ComponentHistory } from '../../engine/instanceTracker';

// ── Types ────────────────────────────────────────────────────

export interface CodeFix {
  /** Brief description of the issue. */
  title: string;
  /** The problematic prop name. */
  propName: string;
  /** The type of fix needed. */
  fixType: 'useCallback' | 'useMemo';
  /** The before code snippet (inline expression). */
  beforeCode: string;
  /** The after code snippet (refactored). */
  afterCode: string;
  /** The component that receives this prop. */
  componentName: string;
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Generate code fixes from component history.
 *
 * Heuristic:
 *   - UNMEMOIZED_CALLBACK → useCallback fix
 *   - PROP_REFERENCE_CHANGE with object-type props → useMemo fix
 */
function generateFixes(histories: ComponentHistory[]): CodeFix[] {
  const fixes: CodeFix[] = [];

  for (const h of histories) {
    if (h.lastRenderReason === 'UNMEMOIZED_CALLBACK') {
      fixes.push({
        title: `Inline callback in ${h.componentName}`,
        propName: 'on*',
        fixType: 'useCallback',
        beforeCode: `<${h.componentName} onClick={() => handler()} />`,
        afterCode: [
          `const onClick = useCallback(() => handler(), []);`,
          `<${h.componentName} onClick={onClick} />`,
        ].join('\n'),
        componentName: h.componentName,
      });
    }

    if (h.lastRenderReason === 'PROP_REFERENCE_CHANGE') {
      fixes.push({
        title: `Recreated object in ${h.componentName}`,
        propName: 'config/style/object',
        fixType: 'useMemo',
        beforeCode: `<${h.componentName} config={{ key: value }} />`,
        afterCode: [
          `const config = useMemo(() => ({ key: value }), []);`,
          `<${h.componentName} config={config} />`,
        ].join('\n'),
        componentName: h.componentName,
      });
    }
  }

  return fixes;
}

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
    marginBottom: '10px',
    overflow: 'hidden' as const,
  },
  cardTitle: {
    padding: '8px 12px',
    fontWeight: 'bold' as const,
    fontSize: '12px',
    color: '#ff8a65',
    borderBottom: '1px solid #2a2a3e',
  },
  section: {
    padding: '8px 12px',
  },
  sectionLabel: {
    color: '#888',
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '4px',
  },
  codeBlock: {
    background: '#0f3460',
    borderRadius: '4px',
    padding: '8px 10px',
    fontFamily: '"SF Mono", "Fira Code", monospace',
    fontSize: '11px',
    lineHeight: '1.6',
    overflow: 'auto' as const,
    whiteSpace: 'pre' as const,
    margin: 0,
  },
  codeBefore: {
    borderLeft: '2px solid #ff5252',
  },
  codeAfter: {
    borderLeft: '2px solid #00e676',
  },
  copyBtn: {
    background: 'none',
    border: '1px solid #7c4dff',
    color: '#7c4dff',
    borderRadius: '4px',
    padding: '3px 10px',
    fontSize: '11px',
    cursor: 'pointer',
    marginTop: '8px',
    display: 'inline-block' as const,
  },
  fixTypeBadge: (type: 'useCallback' | 'useMemo') => ({
    background: type === 'useCallback' ? '#ff6d00' : '#4fc3f7',
    color: '#000',
    borderRadius: '4px',
    padding: '1px 6px',
    fontSize: '10px',
    fontWeight: 'bold' as const,
    marginLeft: '8px',
  }),
  none: {
    color: '#666',
    fontStyle: 'italic',
    fontSize: '12px',
  },
};

// ── Component ────────────────────────────────────────────────

export interface CodeDiffViewProps {
  histories: ComponentHistory[];
}

export function CodeDiffView({ histories }: CodeDiffViewProps): ReactNode {
  const fixes = generateFixes(histories);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = async (code: string, index: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Clipboard API may not be available in all environments
    }
  };

  if (fixes.length === 0) {
    return (
      <div style={s.container}>
        <div style={s.none}>
          No refactoring suggestions yet. Components with unstable references (inline callbacks, recreated objects) will appear here with copy-paste fixes.
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <div style={s.header}>Suggested Fixes ({fixes.length})</div>
      {fixes.map((fix, i) => (
        <div key={i} style={s.card}>
          <div style={s.cardTitle}>
            {fix.title}
            <span style={s.fixTypeBadge(fix.fixType)}>{fix.fixType}</span>
          </div>

          {/* Before */}
          <div style={s.section}>
            <div style={s.sectionLabel}>Before — inline</div>
            <pre style={{ ...s.codeBlock, ...s.codeBefore }}>{fix.beforeCode}</pre>
          </div>

          {/* After */}
          <div style={s.section}>
            <div style={s.sectionLabel}>After — memoized</div>
            <pre style={{ ...s.codeBlock, ...s.codeAfter }}>{fix.afterCode}</pre>
          </div>

          {/* Copy button */}
          <div style={{ padding: '0 12px 8px' }}>
            <button
              onClick={() => handleCopy(fix.afterCode, i)}
              style={s.copyBtn}
            >
              {copiedIndex === i ? 'Copied!' : 'Copy Fix'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
