import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import {
  workerFixture,
  workerSnapshotFixture,
} from '$features/agent-workers/agent-workers.fixture';
import type { AgentWorkersState, WorkerSnapshot } from '$features/agent-workers/types';
import { agentWorkersUpdated } from './agent-workers-slice';
import { selectAgentWorkersIncomplete } from './agent-workers-selectors';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';

const { workspaceId: ws, agentId: agent } = workerSnapshotFixture;
const ended = { ...workerFixture, providerState: 'completed', status: 'completed' as const };
const view = (snapshot: Partial<WorkerSnapshot>): AgentWorkersState => ({
  status: 'ready',
  snapshot: { ...workerSnapshotFixture, ...snapshot },
});
const incomplete = (state: AgentWorkersState) => {
  store.dispatch(agentWorkersUpdated(ws, agent, state));
  return selectAgentWorkersIncomplete.select(store.state, ws, agent);
};

beforeAll(() => store.init());
afterEach(() => store.dispatch(removeWorkspaceEntity(ws)));

/** §5.5b: a truncated, unavailable or failed worker view cannot claim an exhaustive count. */
describe('selectAgentWorkersIncomplete', () => {
  it('is false for a complete supported view, with or without rows', () => {
    expect(incomplete(view({}))).toBe(false);
    expect(incomplete(view({ workers: [] }))).toBe(false);
  });

  it('is true for a truncated view even when every listed row has ended', () => {
    expect(incomplete(view({ truncated: true, workers: [ended] }))).toBe(true);
    expect(incomplete(view({ truncated: true, workers: [] }))).toBe(true);
  });

  it('is true when the worker view failed to load', () => {
    expect(incomplete({ status: 'failed' })).toBe(true);
  });

  it('is true for an unavailable view that still lists rows', () => {
    expect(
      incomplete(view({ support: { status: 'unavailable', reason: 'continuity-lost' } })),
    ).toBe(true);
  });

  it('is false when the agent has no session or its provider reports nothing', () => {
    const none = { support: { status: 'unavailable' as const, reason: 'no-session' }, workers: [] };
    expect(incomplete(view(none))).toBe(false);
    expect(incomplete({ status: 'unsupported' })).toBe(false);
  });
});
