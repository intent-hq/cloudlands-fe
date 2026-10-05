/** Canonical script monitor contract (§5.8a). Output is opt-in and bounded. */
interface ScriptMonitorIdentity {
  monitorId: string;
  workspaceId: string;
  agentId: string;
  scriptId: string;
  runId: string;
  scriptName: string;
  mode: 'command' | 'service';
  createdAt: string;
  expiresAt: string;
  outputPattern?: string;
  lineCount?: number;
}
interface ScriptMonitorResult {
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  stoppedAt: string;
  startedAt?: string;
  exitCode?: number;
  error?: string;
}
export type ScriptMonitor = ScriptMonitorIdentity &
  (
    | { state: 'active' }
    | { state: 'completed'; settledAt: string; reason: 'finished'; result: ScriptMonitorResult }
    | { state: 'expired'; settledAt: string; reason: 'ttl-expired' }
    | {
        state: 'triggered';
        settledAt: string;
        reason: 'output-match';
        trigger: { observedLineCount: number; matchedLine: string };
      }
    | {
        state: 'triggered';
        settledAt: string;
        reason: 'line-count';
        trigger: { observedLineCount: number };
      }
    | {
        state: 'cancelled';
        settledAt: string;
        reason:
          | 'unmonitored'
          | 'owner-deleted'
          | 'owner-retired'
          | 'workspace-archived'
          | 'workspace-deleted';
      }
  );
export interface ScriptMonitorEvent {
  monitor: ScriptMonitor;
}
export type ScriptMonitorEventType =
  | 'scriptMonitor:registered'
  | 'scriptMonitor:completed'
  | 'scriptMonitor:expired'
  | 'scriptMonitor:triggered'
  | 'scriptMonitor:cancelled';
export type ScriptMonitorMutationResult = {
  ok: true;
  monitor: ScriptMonitor;
  runStopped?: boolean;
};
