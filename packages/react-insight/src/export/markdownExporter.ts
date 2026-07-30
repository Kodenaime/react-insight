/**
 * Markdown Diagnostic Exporter — formats telemetry into PR-ready Markdown.
 *
 * All exported values pass through the masker before serialization.
 * This is explicitly stated in spec §8: exported values pass through
 * the same masking pipeline described in §5.1.
 *
 * ## Output format
 *
 * ```markdown
 * ### React Insight Diagnostic Summary
 * **Component:** `ExpenseTable`
 * **Renders Observed:** 18 times (14 unnecessary)
 * **Health Score:** 64 / 100
 *
 * #### Primary Re-render Triggers
 * 1. **Unstable Callback Reference:** `onItemSelect`
 *    - *Cause:* Recreated inline inside `ExpenseDashboard.tsx` (Line 42)
 * 2. **Object Reference Instability:** `filterConfig`
 *    - *Cause:* Values identical within first 4 levels, instance recreated
 *
 * #### Suggested Fix
 * ```tsx
 * const onItemSelect = useCallback((id) => select(id), []);
 * <ExpenseRow onItemSelect={onItemSelect} />
 * ```
 * ```
 */

import type { ComponentHistory } from '../engine/instanceTracker';
import type { HealthScore } from '../engine/healthEngine';
import { maskValueFast } from '../security/masker';

// ── Helpers ──────────────────────────────────────────────────

const WASTED_REASONS = new Set([
  'PARENT_RENDER',
  'PROP_REFERENCE_CHANGE',
  'UNMEMOIZED_CALLBACK',
  'PROP_VALUE_CHANGE',
]);

function isWastedReason(reason?: string): boolean {
  return reason ? WASTED_REASONS.has(reason) : false;
}

function escapeMd(text: string): string {
  return text.replace(/_/g, '\\_').replace(/\|/g, '\\|');
}

// ── Main export function ─────────────────────────────────────

export interface ExportOptions {
  /** Include the full history breakdown. Default: true */
  includeHistory?: boolean;
  /** Maximum number of components to list. Default: 20 */
  maxComponents?: number;
}

/**
 * Generate a PR-ready Markdown diagnostic summary from current telemetry.
 *
 * All values are masked before serialization (spec §5.1 + §8).
 */
export function generateMarkdown(
  histories: ComponentHistory[],
  healthScore: HealthScore,
  options: ExportOptions = {},
): string {
  const { includeHistory = true, maxComponents = 20 } = options;

  // Mask all history data before any rendering
  const maskedHistories = maskValueFast(histories) as ComponentHistory[];

  const totalRenders = histories.reduce((s, h) => s + h.renderCount, 0);
  const wastedCount = maskedHistories.filter(h => h.lastRenderWasted).length;
  const { score, metrics, recommendations } = healthScore;

  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────
  lines.push('### React Insight Diagnostic Summary');
  lines.push('');
  lines.push(`**Health Score:** ${score} / 100`);
  lines.push(`**Components Tracked:** ${maskedHistories.length}`);
  lines.push(`**Renders Observed:** ${totalRenders} (${wastedCount} unnecessary)`);
  lines.push('');

  // ── Health breakdown ──────────────────────────────────────
  if (metrics.length > 0) {
    lines.push('#### Architecture Health Breakdown');
    lines.push('');
    const rows = metrics.map(m =>
      `| ${escapeMd(m.label)} | ${m.value} | -${m.penalty} | ${m.capped ? 'capped' : ''} |`,
    );
    lines.push('| Metric | Value | Penalty | Notes |');
    lines.push('|--------|-------|---------|-------|');
    lines.push(...rows);
    lines.push('');
  }

  // ── Recommendations ────────────────────────────────────
  if (recommendations.length > 0) {
    lines.push('#### Recommendations');
    lines.push('');
    for (const rec of recommendations) {
      lines.push(`**#${rec.priority} — ${rec.title}**`);
      lines.push('');
      lines.push(`> ${rec.description}`);
      lines.push('');
    }
  }

  // ── Primary re-render triggers ────────────────────────────
  if (includeHistory && maskedHistories.length > 0) {
    lines.push('#### Primary Re-render Triggers');
    lines.push('');

    const sorted = [...maskedHistories]
      .filter(h => h.lastRenderReason)
      .sort((a, b) => (b.renderCount || 0) - (a.renderCount || 0))
      .slice(0, maxComponents);

    let triggerIndex = 0;
    for (const h of sorted) {
      if (isWastedReason(h.lastRenderReason)) {
        triggerIndex++;
        lines.push(
          `${triggerIndex}. **${escapeMd(h.lastRenderReason || '')}:** \`${escapeMd(h.componentName)}\``,
        );
        lines.push(`   - *${h.renderCount} renders, wasted: ${h.lastRenderWasted ? 'yes' : 'no'}*`);
        if (h.lastEffectAnalysis?.hasUnboundedEffect) {
          lines.push('   - ⚠ Effect is unbounded (no dependency array)');
        }
        lines.push('');
      }
    }

    // Non-wasted entries
    const nonWasted = sorted.filter(h => !isWastedReason(h.lastRenderReason)).slice(0, 5);
    if (nonWasted.length > 0) {
      lines.push('#### Other Components');
      lines.push('');
      for (const h of nonWasted) {
        lines.push(`- **${escapeMd(h.componentName)}:** ${h.lastRenderReason} (${h.renderCount} renders)`);
      }
      lines.push('');
    }
  }

  // ── Suggested Fixes (from CodeDiffView logic) ─────────────
  const fixes = generateFixes(maskedHistories);
  if (fixes.length > 0) {
    lines.push('#### Suggested Fixes');
    lines.push('');
    for (const fix of fixes) {
      lines.push(`**${fix.title}**`);
      lines.push('');
      lines.push('```tsx');
      lines.push('// Before');
      lines.push(fix.beforeCode);
      lines.push('');
      lines.push('// After');
      lines.push(fix.afterCode);
      lines.push('```');
      lines.push('');
    }
  }

  // ── Footer ────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push(`*Generated by React Insight v1.1 — ${new Date().toISOString().split('T')[0]}*`);

  return lines.join('\n');
}

// ── Fix generation (mirrors CodeDiffView logic) ──────────────

interface FixSnippet {
  title: string;
  beforeCode: string;
  afterCode: string;
}

function generateFixes(histories: ComponentHistory[]): FixSnippet[] {
  const fixes: FixSnippet[] = [];
  for (const h of histories) {
    if (h.lastRenderReason === 'UNMEMOIZED_CALLBACK') {
      fixes.push({
        title: `Inline callback in ${h.componentName}`,
        beforeCode: `<${h.componentName} onClick={() => handler()} />`,
        afterCode: [
          `const onClick = useCallback(() => handler(), []);`,
          `<${h.componentName} onClick={onClick} />`,
        ].join('\n'),
      });
    }
    if (h.lastRenderReason === 'PROP_REFERENCE_CHANGE') {
      fixes.push({
        title: `Recreated object in ${h.componentName}`,
        beforeCode: `<${h.componentName} config={{ key: value }} />`,
        afterCode: [
          `const config = useMemo(() => ({ key: value }), []);`,
          `<${h.componentName} config={config} />`,
        ].join('\n'),
      });
    }
  }
  return fixes.slice(0, 5);
}

/**
 * Generate a Markdown summary and optionally copy to clipboard.
 */
export async function generateAndCopy(histories: ComponentHistory[], healthScore: HealthScore): Promise<string> {
  const md = generateMarkdown(histories, healthScore);
  try {
    await navigator.clipboard.writeText(md);
  } catch {
    // Clipboard may be unavailable (non-HTTPS, server-side, etc.)
  }
  return md;
}
