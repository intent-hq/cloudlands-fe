/**
 * Conversation goal requests (PROTOCOL `methods/agents.md` "Conversation
 * goal"). Each reconciles the session's `goal` from the daemon result at
 * once; the `agent:updated { goal }` push converges every other client.
 */
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import type { GoalSetBy } from '$shared/types/agent-session';
import type { GoalCommandOutcome, SetGoalOutcome } from './utils/goal-command';

const sameSetBy = (a: GoalSetBy | undefined, b: GoalSetBy | undefined): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.principalId === b.principalId &&
    a.displayName === b.displayName &&
    a.login === b.login);

function applyGoal(
  agentId: string,
  workspaceId: string,
  result: { goal: string | null; goalSetBy?: GoalSetBy },
): void {
  const session = appStore.state.agentSessions?.byAgentId[agentId];
  if (!session || session.workspaceId !== workspaceId) return;
  const next = result.goal && result.goal.length > 0 ? result.goal : undefined;
  const setBy = next ? result.goalSetBy : undefined;
  if (session.goal === next && sameSetBy(session.goalSetBy, setBy)) return;
  appStore.dispatch(updateSession(agentId, { goal: next, goalSetBy: setBy }));
}

/** Send a `/goal` composer message; no optimistic row is ever created for it. */
export async function requestGoalCommand(
  workspaceId: string,
  agentId: string,
  content: string,
): Promise<GoalCommandOutcome> {
  const outcome = await appClient.agents.sendGoalCommand({ agentId, workspaceId, content });
  if (outcome.ok && outcome.command) applyGoal(agentId, workspaceId, outcome.command);
  return outcome;
}

/** Set, replace or remove (`null` / empty) the goal from the goal strip. */
export async function requestSetGoal(
  workspaceId: string,
  agentId: string,
  goal: string | null,
): Promise<SetGoalOutcome> {
  const outcome = await appClient.agents.setGoal({ agentId, workspaceId, goal });
  if (outcome.ok) applyGoal(agentId, workspaceId, outcome.result);
  return outcome;
}
