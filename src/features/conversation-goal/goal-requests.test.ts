import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import type { SetGoalOutcome } from './utils/goal-command';

const agents = vi.hoisted(() => ({ setGoal: vi.fn(), sendGoalCommand: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { agents } }));

import { requestGoalCommand, requestSetGoal } from './goal-requests';

const alice = { principalId: 'p-alice', displayName: 'Alice', login: 'alice' };
const bob = { principalId: 'p-bob', displayName: null, login: 'bob' };
const WS = 'ws-goal-requests';
const AGENT = 'agent-goal-requests';

let dispose: (() => void) | undefined;
beforeAll(() => {
  dispose = store.init();
});
afterAll(() => dispose?.());

function seed(goal?: string, goalSetBy?: typeof alice): void {
  store.dispatch(
    bulkUpsertSessions([
      {
        id: AgentId(AGENT),
        backendSessionId: null,
        workspaceId: WorkspaceId(WS),
        name: 'Developer',
        status: AgentStatus.Idle,
        messages: [],
        createdAt: '2026-11-22T08:00:00Z',
        updatedAt: '2026-11-22T08:00:00Z',
        goal,
        goalSetBy,
      } as unknown as AgentSession,
    ]),
  );
}

const session = () => store.state.agentSessions.byAgentId[AGENT];

describe('goal requests reconcile goalSetBy from the result', () => {
  beforeEach(() => {
    agents.setGoal.mockReset();
    agents.sendGoalCommand.mockReset();
  });

  it('replaces the writer on updated', async () => {
    seed('Old goal', alice);
    agents.setGoal.mockResolvedValue({
      ok: true,
      result: { action: 'updated', goal: 'New goal', goalSetBy: bob },
    } satisfies SetGoalOutcome);
    await requestSetGoal(WS, AGENT, 'New goal');
    expect(session().goal).toBe('New goal');
    expect(session().goalSetBy).toEqual(bob);
  });

  it('drops the writer with the goal on cleared', async () => {
    seed('Old goal', alice);
    agents.setGoal.mockResolvedValue({
      ok: true,
      result: { action: 'cleared', goal: null },
    } satisfies SetGoalOutcome);
    await requestSetGoal(WS, AGENT, null);
    expect(session().goal).toBeUndefined();
    expect(session().goalSetBy).toBeUndefined();
  });

  it('does not dispatch when goal and writer are unchanged', async () => {
    seed('Same goal', alice);
    const before = session();
    agents.setGoal.mockResolvedValue({
      ok: true,
      result: { action: 'unchanged', goal: 'Same goal', goalSetBy: { ...alice } },
    } satisfies SetGoalOutcome);
    await requestSetGoal(WS, AGENT, 'Same goal');
    expect(session()).toBe(before);
  });

  it('applies an unattributed command result as no writer', async () => {
    seed('Old goal', alice);
    agents.sendGoalCommand.mockResolvedValue({
      ok: true,
      command: { action: 'updated', goal: 'By an unknown principal' },
    });
    await requestGoalCommand(WS, AGENT, '/goal By an unknown principal');
    expect(session().goal).toBe('By an unknown principal');
    expect(session().goalSetBy).toBeUndefined();
  });
});
