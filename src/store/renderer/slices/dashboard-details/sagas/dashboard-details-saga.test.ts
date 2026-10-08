import { afterEach, describe, expect, it } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { WorkspaceStatus, type AgentSession, type Workspace } from '$shared/types';
import type { WorkspaceEvent } from '$features/events/types';
import type { StoreState } from '../../../types';
import {
  initialState as workspaceInitialState,
  setWorkspaceEntity,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  initialState as sessionsInitialState,
  updateSession,
} from '../../agent-session/agent-session-slice';
import { pendingQuestionRecoveryRequested } from '../../chat-state/chat-state-slice';
import { initialState as hudInitialState } from '../../hud/hud-slice';
import {
  daemonEventsSubscribed,
  eventReceived,
  initialState as eventsInitialState,
  workspaceEventsReducer,
} from '../../workspace-events/workspace-events-slice';
import { fetchWorkspaceTokenUsage } from '../../token-usage/token-usage-slice';
import { ensureAgentSessionLoaded } from '../../workspace-agents/workspace-agents-slice';
import { setDashboardVisibleWorkspaces } from '../dashboard-details-slice';
import { dashboardDetailsSaga } from './dashboard-details-saga';

type DemandAction = ReturnType<
  | typeof setDashboardVisibleWorkspaces
  | typeof daemonEventsSubscribed
  | typeof setWorkspaceEntity
  | typeof bulkUpsertSessions
  | typeof updateSession
  | typeof eventReceived
>;
const tasks: Task[] = [];

function workspace(id: string, agentCount = 1, status = WorkspaceStatus.Active): Workspace {
  const agents = Array.from({ length: agentCount }, (_, index) => ({
    id: `${id}-agent-${index}`,
    name: `Agent ${index}`,
    status: 'active',
  }));
  return {
    id,
    title: id,
    status,
    displayStatus: 'in_progress',
    agentSummary: { count: agentCount, agentIds: agents.map((agent) => agent.id), agents },
  } as Workspace;
}

function start(workspaces: Workspace[]) {
  let state = {
    workspace: { ...workspaceInitialState, workspaces: createCollection('id', workspaces) },
    workspaceEvents: eventsInitialState,
    hud: hudInitialState,
    agentSessions: sessionsInitialState,
  } as StoreState;
  const channel = stdChannel();
  const actions: Array<{ type: string; payload: unknown }> = [];
  const task = runSaga(
    { channel, getState: () => state, dispatch: (action) => actions.push(action) },
    dashboardDetailsSaga,
  );
  tasks.push(task);
  return {
    actions,
    task,
    send(action: DemandAction) {
      state = {
        ...state,
        workspace: workspaceReducer(state.workspace, action),
        agentSessions: agentSessionReducer(state.agentSessions, action),
        workspaceEvents: workspaceEventsReducer(state.workspaceEvents, action),
      };
      channel.put(action);
    },
    tokenRequests: () => actions.filter((action) => action.type === fetchWorkspaceTokenUsage.type),
    agentRequests: () => actions.filter((action) => action.type === ensureAgentSessionLoaded.type),
  };
}

afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
});

describe('dashboard visible-card demand', () => {
  it('loads only visible cards and shares overlapping owners until the final release', () => {
    const run = start([workspace('one'), workspace('two'), workspace('offscreen')]);
    expect(run.actions).toEqual([]);
    run.send(setDashboardVisibleWorkspaces('first', ['one', 'one']));
    run.send(setDashboardVisibleWorkspaces('second', ['one', 'two']));
    run.send(setDashboardVisibleWorkspaces('first', []));
    expect(run.tokenRequests()).toEqual([
      fetchWorkspaceTokenUsage('one'),
      fetchWorkspaceTokenUsage('two'),
    ]);
    expect(run.agentRequests()).toEqual([
      ensureAgentSessionLoaded('one', 'one-agent-0'),
      ensureAgentSessionLoaded('two', 'two-agent-0'),
    ]);
    run.send(setDashboardVisibleWorkspaces('second', []));
    run.send(daemonEventsSubscribed());
    expect(run.tokenRequests()).toHaveLength(2);
    // Re-entry retries a prior failed read through the same canonical owner.
    run.send(setDashboardVisibleWorkspaces('first', ['one']));
    expect(run.tokenRequests()).toHaveLength(3);
  });

  it('bounds combined viewport demand and per-card agent reads', () => {
    const rows = Array.from({ length: 40 }, (_, i) => workspace(`ws-${i}`, 20));
    const run = start(rows);
    run.send(
      setDashboardVisibleWorkspaces(
        'first',
        rows.slice(0, 20).map((row) => String(row.id)),
      ),
    );
    run.send(
      setDashboardVisibleWorkspaces(
        'second',
        rows.slice(20).map((row) => String(row.id)),
      ),
    );
    expect(run.tokenRequests()).toHaveLength(24);
    expect(run.agentRequests()).toHaveLength(24 * 12);
    expect(run.tokenRequests().at(-1)).toEqual(fetchWorkspaceTokenUsage('ws-23'));
  });

  it('refreshes remaining visible demand after resubscription and ignores stale acknowledgements', () => {
    const run = start([workspace('one'), workspace('two')]);
    run.send(setDashboardVisibleWorkspaces('cards', ['one', 'two']));
    run.send(setDashboardVisibleWorkspaces('cards', ['two']));
    run.send(daemonEventsSubscribed(9));
    expect(run.tokenRequests()).toHaveLength(2);
    run.send(daemonEventsSubscribed());
    expect(run.tokenRequests()).toEqual([
      fetchWorkspaceTokenUsage('one'),
      fetchWorkspaceTokenUsage('two'),
      fetchWorkspaceTokenUsage('two'),
    ]);
    expect(run.agentRequests().at(-1)).toEqual(ensureAgentSessionLoaded('two', 'two-agent-0'));
  });

  it('skips removed and archived workspaces and stops requests when cancelled', async () => {
    const run = start([workspace('archived', 1, WorkspaceStatus.Archived), workspace('one')]);
    run.send(setDashboardVisibleWorkspaces('cards', ['missing', 'archived', 'one']));
    expect(run.tokenRequests()).toEqual([fetchWorkspaceTokenUsage('one')]);
    run.task.cancel();
    await run.task.toPromise();
    run.send(daemonEventsSubscribed());
    run.send(setDashboardVisibleWorkspaces('cards', ['one']));
    expect(run.tokenRequests()).toHaveLength(1);
  });

  it('loads newly appearing card agents without refetching usage or other visible cards', () => {
    const run = start([workspace('one'), workspace('two')]);
    run.send(setDashboardVisibleWorkspaces('cards', ['one', 'two']));
    run.actions.length = 0;
    run.send(setWorkspaceEntity(workspace('one', 2)));
    run.send(setWorkspaceEntity(workspace('one', 2)));
    expect(run.actions).toEqual([ensureAgentSessionLoaded('one', 'one-agent-1')]);
    run.actions.length = 0;
    run.send(setWorkspaceEntity(workspace('offscreen', 3)));
    expect(run.actions).toEqual([]);
  });

  it('deduplicates targeted question recovery across event bursts and admits a newer marker', () => {
    const run = start([workspace('one'), workspace('two'), workspace('offscreen')]);
    run.send(setDashboardVisibleWorkspaces('cards', ['one', 'two']));
    run.actions.length = 0;
    const agent = {
      id: 'one-agent-0',
      workspaceId: 'one',
      name: 'Coordinator',
      status: 'idle',
      messages: [],
      metadata: { pendingQuestionsMessageId: 'q-one' },
    } as AgentSession;
    run.send(bulkUpsertSessions([agent]));
    run.send(bulkUpsertSessions([agent]));
    run.send(updateSession('one-agent-0', { metadata: { pendingQuestionsMessageId: 'q-one' } }));
    for (let index = 0; index < 5; index++) {
      run.send(
        eventReceived('one', {
          id: `event-${index}`,
          workspaceId: 'one',
          type: 'agent:updated',
          timestamp: '2026-10-08T20:01:00Z',
          data: { agentId: 'one-agent-0' },
        } as WorkspaceEvent),
      );
    }
    expect(run.actions).toEqual([pendingQuestionRecoveryRequested('one-agent-0', 'q-one')]);
    run.send(updateSession('one-agent-0', { metadata: { pendingQuestionsMessageId: 'q-two' } }));
    expect(run.actions.at(-1)).toEqual(pendingQuestionRecoveryRequested('one-agent-0', 'q-two'));
    run.actions.length = 0;
    run.send(
      bulkUpsertSessions([
        { ...agent, id: 'offscreen-agent-0', workspaceId: 'offscreen' } as AgentSession,
      ]),
    );
    expect(run.actions).toEqual([]);
    run.send(setDashboardVisibleWorkspaces('cards', []));
    run.send(updateSession('one-agent-0', { metadata: { pendingQuestionsMessageId: 'q-three' } }));
    expect(run.actions).toEqual([]);
  });
});
