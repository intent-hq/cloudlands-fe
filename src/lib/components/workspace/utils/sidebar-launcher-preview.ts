import type { AgentSession, Note } from '$shared/types';
import { getAgentPeekData } from '$lib/utils/agent-peek-utils';
import { stripInternalDeliveryNotes } from '$lib/utils/user-message-presentation';
import { stripMarkdownFormatting, stripUserMessagePrefixes } from '$lib/utils/text-utils';

export interface AgentLauncherPreview {
  lastUserMessage: string;
  response: string;
}

export interface AgentLauncherItem {
  agent: AgentSession;
  isRunning: boolean;
  preview: AgentLauncherPreview;
}

export interface NoteLauncherState {
  launcherNotes: Note[];
  totalNotes: number;
  overflowCount: number;
}

export function getAgentLauncherStatusPriority(state: string): number {
  if (state === 'failed') return 3;
  if (
    state === 'question' ||
    state === 'needs-permission' ||
    state === 'attention-blocker' ||
    state === 'attention-discussion'
  ) {
    return 2;
  }
  if (state === 'running' || state === 'responding') return 1;
  return 0;
}

export function getLauncherPreviewLimit(
  availableWidth: number,
  overflowWidth: number,
  maxLimit: number,
  targetSize: number,
  stepSize: number,
): number {
  if (availableWidth <= 0) return maxLimit;
  const fixedWidth = targetSize + Math.max(targetSize, overflowWidth);
  const fittingLimit = Math.floor((availableWidth - fixedWidth) / stepSize) + 1;
  return Math.max(1, Math.min(maxLimit, fittingLimit));
}

export function deriveAgentLauncherItems(
  agents: AgentSession[],
  limit: number,
  getIsRunning: (agent: AgentSession) => boolean,
  buildPreview: (agent: AgentSession, isRunning: boolean) => AgentLauncherPreview,
  getStatusPriority: (agent: AgentSession) => number = (agent) => Number(getIsRunning(agent)),
): {
  launcherAgents: AgentLauncherItem[];
  runningAgents: AgentSession[];
  totalAgents: number;
  overflowCount: number;
} {
  const uniqueAgents = [...new Map(agents.map((agent) => [agent.id, agent])).values()];
  const agentStates = uniqueAgents.map((agent) => ({
    agent,
    isRunning: getIsRunning(agent),
    statusPriority: getStatusPriority(agent),
  }));
  const runningAgents = agentStates.filter(({ isRunning }) => isRunning).map(({ agent }) => agent);
  const primaryAgentId = findPrimaryAgent(uniqueAgents)?.id;
  const orderedAgentStates = agentStates.sort(
    (a, b) =>
      b.statusPriority - a.statusPriority ||
      Number(b.agent.hasUnread === true) - Number(a.agent.hasUnread === true) ||
      compareAgentsByLastMessage(a.agent, b.agent),
  );
  const primaryState = primaryAgentId
    ? orderedAgentStates.find(({ agent }) => agent.id === primaryAgentId)
    : undefined;
  const launcherAgents = (
    primaryState
      ? [primaryState, ...orderedAgentStates.filter(({ agent }) => agent.id !== primaryAgentId)]
      : orderedAgentStates
  )
    .slice(0, Math.max(0, limit))
    .map(({ agent, isRunning }) => ({
      agent,
      isRunning,
      preview: buildPreview(agent, isRunning),
    }));

  return {
    launcherAgents,
    runningAgents,
    totalAgents: agentStates.length,
    overflowCount: Math.max(0, agentStates.length - launcherAgents.length),
  };
}

function getCreatedTimestamp(agent: AgentSession): number {
  const time = new Date(agent.createdAt).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function comparePrimaryCandidates(a: AgentSession, b: AgentSession): number {
  return (
    getCreatedTimestamp(a) - getCreatedTimestamp(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function isMarkedInitialAgent(agent: AgentSession): boolean {
  const session = agent as AgentSession & { isInitialWorkspaceAgent?: boolean };
  return (
    agent.isInitialAgent === true ||
    session.isInitialWorkspaceAgent === true ||
    agent.metadata?.isInitialAgent === true ||
    agent.metadata?.isInitialWorkspaceAgent === true ||
    agent.agentMetadata?.isInitialAgent === true ||
    agent.agentMetadata?.isInitialWorkspaceAgent === true
  );
}

function isLegacyRootCoordinator(agent: AgentSession): boolean {
  const legacyAgent = agent as AgentSession & {
    parentAgentId?: string;
    config?: { specialist?: string };
  };
  const parentAgentId =
    agent.metadata?.createdByAgentId ??
    agent.agentMetadata?.createdByAgentId ??
    legacyAgent.parentAgentId;
  const specialist =
    agent.metadata?.specialist ?? agent.agentMetadata?.specialist ?? legacyAgent.config?.specialist;
  const isCoordinator =
    specialist === 'spec-writer' || agent.name?.trim().toLowerCase() === 'coordinator';
  return !parentAgentId && isCoordinator;
}

function findPrimaryAgent(agents: AgentSession[]): AgentSession | undefined {
  const markedInitial = agents.filter(isMarkedInitialAgent).sort(comparePrimaryCandidates)[0];
  return markedInitial ?? agents.filter(isLegacyRootCoordinator).sort(comparePrimaryCandidates)[0];
}

export function deriveNoteLauncherItems(
  notes: Note[],
  limit: number,
  isRootNote: (note: Note, notes: Note[]) => boolean,
): NoteLauncherState {
  const rootNotes = notes.filter((note) => isRootNote(note, notes));
  const specNote = rootNotes.find((note) => note.id === 'spec');
  const orderedNotes = specNote
    ? [specNote, ...rootNotes.filter((note) => note.id !== specNote.id)]
    : rootNotes;
  const launcherNotes = orderedNotes.slice(0, Math.max(0, limit));

  return {
    launcherNotes,
    totalNotes: rootNotes.length,
    overflowCount: Math.max(0, rootNotes.length - launcherNotes.length),
  };
}

function getTimestamp(value: Date | string | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getLastActivityTimestamp(agent: AgentSession): number {
  return Math.max(
    getTimestamp(agent.messages.at(-1)?.timestamp),
    getTimestamp(agent.lastActivity),
    getTimestamp(agent.updatedAt),
    getTimestamp(agent.createdAt),
  );
}

export function compareAgentsByLastMessage(a: AgentSession, b: AgentSession): number {
  return (
    getLastActivityTimestamp(b) - getLastActivityTimestamp(a) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function getAgentLauncherPreview(agent: AgentSession): AgentLauncherPreview {
  // The response preview is the wire `lastAgentResponse` (served via
  // getAgentPeekData; push-applied ~1s by `agent:stream:activity` while
  // streaming) — no client-side stream-buffer re-derivation (monorepo#2843).
  const peek = getAgentPeekData(agent);
  const lastUserMessage = stripUserMessagePrefixes(
    stripInternalDeliveryNotes(peek?.lastUserMessage ?? ''),
  )
    .replace(/\s+/g, ' ')
    .trim();

  return {
    lastUserMessage,
    // getAgentPeekData clears lastResponse while a live tool call is in
    // flight (the tool overlay wins on chip-capable surfaces); this hover
    // card is text-only, so fall back to the wire lastAgentResponse (still
    // server-cleaned) instead of rendering an empty response row.
    response: peek?.lastResponse?.trim() || agent.lastAgentResponse?.trim() || '',
  };
}

export function getNoteLauncherPreview(note: Note): string {
  return stripMarkdownFormatting(note.content)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
