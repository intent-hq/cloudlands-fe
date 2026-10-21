import type { WorkerObservation, WorkerSnapshot } from './types';

const scope = {
  workspaceId: 'ws-workers',
  agentId: 'agent-workers',
  provider: 'claude-code',
  acpSessionId: 'session-1',
  connectionGeneration: 'generation-1',
};

/** A running Claude background shell, as `agent.workers.list` reports it (§5.5b). */
export const workerFixture: WorkerObservation = {
  identity: { ...scope, asyncTaskId: 'bg-1' },
  toolCallId: 'toolu-1',
  // i18n-ignore (fixture shell command)
  name: 'npm run dev',
  taskType: 'shell',
  canStop: true,
  firstObservedAt: Date.parse('2026-10-20T10:00:00Z'),
  observedAt: Date.parse('2026-10-20T10:00:00Z'),
  providerState: 'running',
  source: 'claude-air',
  cause: 'unavailable',
  exitEvidence: { kind: 'unknown' },
  status: 'running',
};

export const workerSnapshotFixture: WorkerSnapshot = {
  ...scope,
  support: { status: 'supported' },
  continuity: 'continuous',
  asOf: Date.parse('2026-10-20T10:00:01Z'),
  truncated: false,
  workers: [workerFixture],
};
