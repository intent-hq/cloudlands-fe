/**
 * Labs "Hide automated activity": folds back-to-back automated turns (wakes,
 * agent-to-agent sends, hook and monitor deliveries) and the agent's replies
 * to them into runs that the transcript shows as one collapsible hint row.
 * Human turns (including Q&A answers) always end a run.
 */

import type { AgentMessage, Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { isAutomatedChatMessage } from '$lib/utils/previous-user-message';
import { getAgentMessageAttribution } from '$lib/utils/agent-message-attribution';
import { getPrMonitorWakeChipLabel } from '$lib/utils/pr-monitor-wake-attribution';
import { getAutomatedWakePresentation } from './automated-wake-presentation';
import { isEventWakeMessage } from './event-wake-summary';
import type { ConversationTurn } from './conversation-turns';

export interface AutomatedActivityRun {
  /** Stable id: the key of the run's first turn. */
  id: string;
  turnKeys: string[];
  firstTurnKey: string;
  lastTurnKey: string;
  /** Automated deliveries in the run (assistant-only continuations excluded). */
  updateCount: number;
  /** Distinct source names in transcript order. */
  sources: string[];
}

export interface AutomatedActivityPlan {
  runs: AutomatedActivityRun[];
  runByTurnKey: Map<string, AutomatedActivityRun>;
}

export interface AutomatedActivityPlanOptions {
  sourceLabel: (message: AgentMessage) => string | null;
}

export const EMPTY_AUTOMATED_ACTIVITY_PLAN: AutomatedActivityPlan = {
  runs: [],
  runByTurnKey: new Map(),
};

export function planAutomatedActivityRuns(
  turns: ReadonlyArray<{ key: string; turn: ConversationTurn }>,
  { sourceLabel }: AutomatedActivityPlanOptions,
): AutomatedActivityPlan {
  const runs: AutomatedActivityRun[] = [];
  const runByTurnKey = new Map<string, AutomatedActivityRun>();
  let open: AutomatedActivityRun | null = null;

  for (const { key, turn } of turns) {
    const user = turn.userMessage;
    if (user && !isAutomatedChatMessage(user)) {
      open = null;
      continue;
    }
    if (!user && !open) continue;
    if (!open) {
      open = {
        id: key,
        turnKeys: [],
        firstTurnKey: key,
        lastTurnKey: key,
        updateCount: 0,
        sources: [],
      };
      runs.push(open);
    }
    open.turnKeys.push(key);
    open.lastTurnKey = key;
    if (user) {
      open.updateCount += 1;
      const label = sourceLabel(user)?.trim();
      if (label && !open.sources.includes(label)) open.sources.push(label);
    }
    runByTurnKey.set(key, open);
  }

  return { runs, runByTurnKey };
}

/** Short name of who sent an automated message, reusing the wake-card labels. */
export function automatedActivitySourceLabel(
  message: AgentMessage,
  workspace?: Workspace | null,
): string | null {
  const attribution = getAgentMessageAttribution(message.metadata);
  if (attribution) {
    return attribution.kind === 'chief' ? m.layout_chiefCard_title() : attribution.displayName;
  }
  const wake = getAutomatedWakePresentation(message);
  if (wake?.kind === 'hook') return wake.attribution.displayName;
  if (wake?.kind === 'script') return wake.attribution.scriptName;
  if (wake?.kind === 'pr') {
    const repo =
      workspace?.repositoryOwner && workspace?.repositoryName
        ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
        : undefined;
    return getPrMonitorWakeChipLabel(wake.attribution, repo);
  }
  if (isEventWakeMessage(message)) return m.chat_automatedActivity_workspaceEvents_label();
  return null;
}
