import { createAsyncAction } from '@themislib/themis/utils/store/create-action';
import type { GoalCommandOutcome, SetGoalOutcome } from './utils/goal-command';

/**
 * Send a `/goal` composer message (`agent.sendMessage` + `interpretCommands`).
 * Resolves with the outcome; the composer clears only on `ok`.
 */
export const goalCommandSendRequested = createAsyncAction<
  [workspaceId: string, agentId: string, content: string],
  GoalCommandOutcome
>('conversationGoal/commandSend', 'conversationGoal/commandSendRequested');

/** Set, replace or remove the conversation goal (`agent.setGoal`). Resolves with the outcome. */
export const goalSetRequested = createAsyncAction<
  [workspaceId: string, agentId: string, goal: string | null],
  SetGoalOutcome
>('conversationGoal/set', 'conversationGoal/setRequested');
