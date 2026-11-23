import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { AgentStatus, type AgentSession } from '$shared/types';
import type { GoalSetBy } from '$shared/types/agent-session';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import {
  bulkUpsertSessions,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import type { GoalCommandOutcome, SetGoalOutcome } from './utils/goal-command';

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

function seed(goal?: string, goalSetBy?: GoalSetBy): void {
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

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  it('ignores a delayed /goal response once a newer goal projection has landed', async () => {
    seed('X', alice);
    const pending = deferred<GoalCommandOutcome>();
    agents.sendGoalCommand.mockReturnValue(pending.promise);
    const request = requestGoalCommand(WS, AGENT, '/goal');
    // Bob's X -> Y -> X writes arrive as agent:updated pushes meanwhile.
    store.dispatch(updateSession(AGENT, { goal: 'Y', goalSetBy: bob }));
    store.dispatch(updateSession(AGENT, { goal: 'X', goalSetBy: bob }));
    pending.resolve({ ok: true, command: { action: 'shown', goal: 'X', goalSetBy: alice } });
    await request;
    expect(session().goal).toBe('X');
    expect(session().goalSetBy).toEqual(bob);
  });

  it('ignores a delayed setGoal response after same-value pushes (A -> B -> A)', async () => {
    seed('X', alice);
    const pending = deferred<SetGoalOutcome>();
    agents.setGoal.mockReturnValue(pending.promise);
    const request = requestSetGoal(WS, AGENT, 'Z');
    store.dispatch(updateSession(AGENT, { goal: 'Y', goalSetBy: bob }));
    store.dispatch(updateSession(AGENT, { goal: 'X', goalSetBy: alice }));
    pending.resolve({ ok: true, result: { action: 'updated', goal: 'Z', goalSetBy: bob } });
    await request;
    expect(session().goal).toBe('X');
    expect(session().goalSetBy).toEqual(alice);
  });

  it('ignores a delayed response after a session read changed the goal', async () => {
    seed('X', alice);
    const pending = deferred<SetGoalOutcome>();
    agents.setGoal.mockReturnValue(pending.promise);
    const request = requestSetGoal(WS, AGENT, 'Z');
    seed('W', bob);
    pending.resolve({ ok: true, result: { action: 'updated', goal: 'Z', goalSetBy: alice } });
    await request;
    expect(session().goal).toBe('W');
    expect(session().goalSetBy).toEqual(bob);
  });
});
