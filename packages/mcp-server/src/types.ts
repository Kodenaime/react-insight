import type { DiagnosticReportV1 } from 'react-insight/schema';

/**
 * The health-score subset the bridge carries. The browser's engine produces the
 * full HealthScore object; we only type the fields the MCP tools consume so the
 * bridge stays a loose JSON contract (no compile-time coupling between the two
 * packages beyond the shared schema).
 */
export interface HealthScoreSnapshot {
  score: number;
  metrics: Array<{
    name: string;
    label: string;
    value: number;
    penalty: number;
    weight: number;
    capped: boolean;
  }>;
}

/** A single browser→server push: the full masked report + health breakdown. */
export interface BridgeSnapshot {
  report: DiagnosticReportV1;
  healthScore: HealthScoreSnapshot;
}

export interface NoActiveSession {
  status: 'no_active_session';
  message: string;
}
