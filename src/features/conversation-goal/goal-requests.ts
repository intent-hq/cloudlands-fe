/**
 * Conversation goal requests (PROTOCOL `methods/agents.md` "Conversation
 * goal"). Each reconciles the session's `goal` / `goalSetBy` from the
 * daemon result at once, unless a newer goal projection landed while the
 * request was in flight; the `agent:updated { goal, goalSetBy }` push
 * converges every client.
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

/**
 * The goal projection a request starts from: the stored values plus their
 * per-field projection versions, which every `updateSession` advances (even
 * a same-value push). Values also catch session reads, which do not advance
 * the versions.
 */
interface GoalFence {
  goal: string | undefined;
  goalSetBy: GoalSetBy | undefined;
  goalVersion: number | undefined;
  goalSetByVersion: number | undefined;
}

function goalFence(agentId: string): GoalFence {
  const state = appStore.state.agentSessions;
  const session = state?.byAgentId[agentId];
  const versions = state?.projectionVersions?.[agentId]?.fields;
  return {
    goal: session?.goal,
    goalSetBy: session?.goalSetBy,
    goalVersion: versions?.goal,
    goalSetByVersion: versions?.goalSetBy,
  };
}

function sameFence(a: GoalFence, b: GoalFence): boolean {
  return (
    a.goal === b.goal &&
    sameSetBy(a.goalSetBy, b.goalSetBy) &&
    a.goalVersion === b.goalVersion &&
    a.goalSetByVersion === b.goalSetByVersion
  );
}

function applyGoal(
  agentId: string,
  workspaceId: string,
  result: { goal: string | null; goalSetBy?: GoalSetBy },
  before: GoalFence,
): void {
  const session = appStore.state.agentSessions?.byAgentId[agentId];
  if (!session || session.workspaceId !== workspaceId) return;
  // A push or read that landed meanwhile is newer than this response (an
  // older write's result, or a `shown` read of a goal since rewritten).
  if (!sameFence(before, goalFence(agentId))) return;
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
  const before = goalFence(agentId);
  const outcome = await appClient.agents.sendGoalCommand({ agentId, workspaceId, content });
  if (outcome.ok && outcome.command) applyGoal(agentId, workspaceId, outcome.command, before);
  return outcome;
}

/** Set, replace or remove (`null` / empty) the goal from the goal strip. */
export async function requestSetGoal(
  workspaceId: string,
  agentId: string,
  goal: string | null,
): Promise<SetGoalOutcome> {
  const before = goalFence(agentId);
  const outcome = await appClient.agents.setGoal({ agentId, workspaceId, goal });
  if (outcome.ok) applyGoal(agentId, workspaceId, outcome.result, before);
  return outcome;
}
