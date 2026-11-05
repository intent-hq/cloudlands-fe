import { describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ listForAgent: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { skills: { listForAgent: mocks.listForAgent } },
}));

import { agentSkillsSaga } from './agent-skills-saga';
import {
  agentSkillsChanged,
  initialState,
  loadAgentSkillsRequested,
  skillsReducer,
} from './skills-slice';
import type { AgentSkills } from './skills-types';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const result = (name: string): AgentSkills => ({
  skills: [{ name, description: '', location: `/m/${name}` }],
  stale: false,
  unavailable: null,
});

function harness() {
  const channel = stdChannel();
  let skills = initialState;
  const dispatched: { type: string }[] = [];
  const dispatch = (action: { type: string }) => {
    dispatched.push(action);
    skills = skillsReducer(skills, action as never);
    channel.put(action);
  };
  runSaga({ channel, dispatch, getState: () => ({ skills }) }, agentSkillsSaga);
  return { dispatch, dispatched, state: () => skills };
}

describe('agentSkillsSaga', () => {
  it('keeps only the latest reply for an agent', async () => {
    let releaseFirst: (value: AgentSkills) => void = () => {};
    mocks.listForAgent
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce(result('new'));
    const run = harness();
    run.dispatch(loadAgentSkillsRequested('ws-1', 'a1'));
    run.dispatch(loadAgentSkillsRequested('ws-1', 'a1'));
    await settle();
    releaseFirst(result('old'));
    await settle();
    expect(run.state().byAgentId.a1.skills.map((s) => s.name)).toEqual(['new']);
    expect(run.state().byAgentId.a1.loaded).toBe(true);
  });

  it('refreshes on skills:changed only for an agent it already loaded', async () => {
    mocks.listForAgent.mockReset().mockResolvedValue(result('x'));
    const run = harness();
    run.dispatch(agentSkillsChanged('ws-1', 'a2'));
    await settle();
    expect(mocks.listForAgent).not.toHaveBeenCalled();

    run.dispatch(loadAgentSkillsRequested('ws-1', 'a2'));
    await settle();
    run.dispatch(agentSkillsChanged('ws-1', 'a2'));
    await settle();
    expect(mocks.listForAgent).toHaveBeenCalledTimes(2);
  });

  it('keeps the last list when a refresh fails', async () => {
    mocks.listForAgent
      .mockReset()
      .mockResolvedValueOnce(result('kept'))
      .mockRejectedValueOnce(new Error('offline'));
    const run = harness();
    run.dispatch(loadAgentSkillsRequested('ws-1', 'a3'));
    await settle();
    run.dispatch(loadAgentSkillsRequested('ws-1', 'a3'));
    await settle();
    expect(run.state().byAgentId.a3).toMatchObject({
      error: 'offline',
      loading: false,
      skills: [{ name: 'kept' }],
    });
  });
});
