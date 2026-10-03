import type { ScriptMonitor } from './types';
import type { ScriptWithState } from '$features/scripts/types';
export const monitorFixture: ScriptMonitor = {
  monitorId: 'monitor-checks',
  workspaceId: 'monitor-preview',
  agentId: 'agent-checks',
  scriptId: 'checks',
  runId: 'run-checks-1',
  scriptName: 'Frontend checks',
  mode: 'command',
  state: 'active',
  createdAt: '2026-10-02T10:00:00Z',
  expiresAt: '2026-10-02T10:10:00Z',
  outputPattern: '^Tests:.*passed$',
  lineCount: 200,
};
export const scriptFixture: ScriptWithState = {
  id: 'checks',
  workspaceId: 'monitor-preview',
  name: 'Frontend checks',
  mode: 'command',
  command: 'pnpm test',
  source: 'user',
  createdAt: '2026-10-02T10:00:00Z',
  runtime: { status: 'running', restartCount: 0, runId: 'run-checks-1' },
};
