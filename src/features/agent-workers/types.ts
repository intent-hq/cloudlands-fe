/** Provider worker observations (PROTOCOL §5.5b). Rows are provider reports, not process state. */
interface WorkerIdentity {
  workspaceId: string;
  agentId: string;
  provider: string;
  acpSessionId: string;
  connectionGeneration: string;
  asyncTaskId: string;
}

type WorkerStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'unknown';

export interface WorkerObservation {
  identity: WorkerIdentity;
  toolCallId?: string;
  /** Untrusted provider label; for a shell usually its command line. */
  name?: string;
  taskType?: string;
  canStop: boolean;
  firstObservedAt: number;
  observedAt: number;
  providerState: 'running' | 'completed' | 'failed' | 'stopped';
  source: string;
  cause: 'unavailable';
  exitEvidence: { kind: 'unknown' };
  status: WorkerStatus;
  unknownReason?: 'disconnected' | 'lost';
}

export interface WorkerSnapshot {
  workspaceId: string;
  agentId: string;
  provider: string;
  acpSessionId: string | null;
  connectionGeneration: string | null;
  support: { status: 'supported' | 'unsupported' | 'unavailable'; reason?: string };
  continuity: 'continuous' | 'disconnected' | 'lost';
  asOf: number;
  truncated: boolean;
  workers: WorkerObservation[];
}

type AgentWorkersStatus = 'loading' | 'ready' | 'failed' | 'unsupported';

export interface AgentWorkersState {
  status: AgentWorkersStatus;
  snapshot?: WorkerSnapshot;
}

export interface WorkerStopResult {
  asyncTaskId: string;
  stopped: boolean;
}
