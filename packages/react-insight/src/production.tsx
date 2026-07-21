import type { ReactNode } from 'react';
import type { ReactInsightProps } from './index';

/**
 * Production noop shell for React Insight.
 *
 * When process.env.NODE_ENV === 'production', bundlers resolve via the
 * "default" conditional export in package.json, which points here.
 *
 * This module must:
 *   - Render null / {children} only — no side effects, no hooks, no observers.
 *   - Be tree-shakeable (zero runtime footprint in minified production bundles).
 *   - Export identical types as the development entry so consumer code compiles
 *     identically regardless of NODE_ENV.
 *
 * Acceptance criteria:
 *   - Importing in a test with NODE_ENV='production' calls zero React hooks.
 *   - Bundle size impact is effectively 0 bytes after minification.
 */

function noopEffect(): void {
  /* intentional noop — force Terser to keep this a noop */
}

/**
 * Production shell.
 *
 * Renders children unmodified. No hook calls, no observers, no masking.
 * All props are accepted (for type compatibility) but ignored.
 * The entire function is a candidate for dead-code elimination.
 */
export function ReactInsight({ children }: ReactInsightProps): ReactNode {
  // Single noop to suppress any "unused parameter" lint in strict tsconfigs.
  // Terser/terser will DCE this call in practice.
  noopEffect();
  return <>{children}</>;
}

export default ReactInsight;
