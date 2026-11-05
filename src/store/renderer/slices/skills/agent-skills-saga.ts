/**
 * A remote agent's `/` menu lists its machine's skills (PROTOCOL agent-aux.md
 * § Skills of a remote agent): `skill.list` with `agentId`, refreshed when
 * `skills:changed` names the agent.
 */
import type { Task } from 'redux-saga';
import { call, cancel, fork, put, take, takeEvery } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import {
  agentSkillsChanged,
  loadAgentSkillsFailed,
  loadAgentSkillsRequested,
  setAgentSkills,
} from './skills-slice';
import type { AgentSkills } from './skills-types';
import { selectAgentSkillsLoaded } from './skills-selectors';

function* loadAgentSkills(action: ReturnType<typeof loadAgentSkillsRequested>) {
  const [workspaceId, agentId] = action.payload;
  try {
    const result: AgentSkills = yield* call(
      [appClient.skills, appClient.skills.listForAgent],
      workspaceId,
      agentId,
    );
    yield* put(setAgentSkills(agentId, result));
  } catch (error) {
    yield* put(
      loadAgentSkillsFailed(agentId, error instanceof Error ? error.message : String(error)),
    );
  }
}

function* refreshOnSkillsChanged(action: ReturnType<typeof agentSkillsChanged>) {
  const [workspaceId, agentId] = action.payload;
  const known = yield* selectAgentSkillsLoaded.effect(agentId);
  if (known) yield* put(loadAgentSkillsRequested(workspaceId, agentId));
}

/** One read per agent: a newer request cancels a slower older one. */
function* latestPerAgent() {
  const running = new Map<string, Task>();
  while (true) {
    const action = yield* take(loadAgentSkillsRequested);
    const agentId = action.payload[1];
    const previous = running.get(agentId);
    if (previous?.isRunning()) yield* cancel(previous);
    running.set(agentId, yield* fork(loadAgentSkills, action));
  }
}

export function* agentSkillsSaga() {
  yield* fork(latestPerAgent);
  yield* takeEvery(agentSkillsChanged, refreshOnSkillsChanged);
}
