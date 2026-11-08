/**
 * DiagnosticReportV1 — the versioned, agent-readable contract.
 *
 * ## Stability Guarantees
 *
 * This schema is a PUBLIC API. Coding agents (Claude Code, Cursor, CI-based
 * agents) code against it, so it must be versioned deliberately.
 *
 *   - **Additive-only changes** bump `schemaVersion` at the MINOR level
 *     (e.g. 1.0 → 1.1) and MUST be optional/backward-compatible.
 *   - **Breaking changes** (renaming, removing, or reshaping an existing field)
 *     require a NEW type `DiagnosticReportV2` — never a silent reshape of V1.
 *
 * Nothing here is derived from raw Fiber internals. Every value that reaches
 * this shape has already passed through the masking pipeline (§5.1).
 */

// ─────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────

/** Current schema version. Bump minor for additive changes. */
export const SCHEMA_VERSION = '1.0';

/**
 * Effect finding — a single effect execution reason for a component.
 * STABLE: `hookIndex` and `status` are contractual. `cause` is a human-readable
 * string and may change wording across versions without a schema bump.
 */
export interface EffectFinding {
  /** 0-based index of the useEffect hook within the component. STABLE */
  hookIndex: number;
  /** Classified effect status. Values are STABLE enums. */
  status: string;
  /** Human-readable cause. NOT stable wording — do not parse for logic. */
  cause: string;
  /** Indices in the dependency array that changed. STABLE shape. */
  changedDependencyIndices: number[];
}

/**
 * Component diagnostic — per-component telemetry.
 * STABLE: `name`, `renderCount`, `wastedRenderRatio`.
 * `renderReasons` is a snapshot of recent render causes; `effectFindings`
 * may be empty when no effects are tracked.
 */
export interface ComponentDiagnostic {
  /** Display name of the component. STABLE */
  name: string;
  /** Total committed renders since mount. STABLE */
  renderCount: number;
  /**
   * Ratio of wasted renders to total renders (0–1).
   * STABLE. Derived from wastedRenderCount / renderCount.
   */
  wastedRenderRatio: number;
  /** Synthetic instance ID. STABLE shape, but not guaranteed to be human-readable. */
  instanceId: string;
  /** Recent render reasons, most recent first. STABLE enum values. */
  renderReasons: string[];
  /** Effect findings for this component. STABLE shape. */
  effectFindings: EffectFinding[];
}

/**
 * The top-level versioned report.
 *
 * STABLE fields: `schemaVersion`, `generatedAt`, `appHealthScore`, `components`.
 * Additive fields may be appended in minor versions.
 */
export interface DiagnosticReportV1 {
  /** Schema version string — MAJOR.MINOR. Agents gate on this. STABLE */
  schemaVersion: string;
  /** ISO-8601 timestamp of report generation. STABLE format. */
  generatedAt: string;
  /** Overall architecture health score, 0–100. STABLE */
  appHealthScore: number;
  /** All tracked components. STABLE shape. */
  components: ComponentDiagnostic[];
}
