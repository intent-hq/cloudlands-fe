import type { WorkspaceEvent } from '$features/events/types';
import { getActivityLabel } from '$features/events/activity-labels';
import {
  isSourceFileActivityEvent,
  isWorkspaceStatusUpdateEvent,
} from '$features/log/utils/activity-event-visibility';
import { m } from '$shared/paraglide/messages.js';
import type { PresenceIdentity } from '$store/renderer/slices/presence/presence-types';
import { getHumanMessageAuthor } from '$lib/utils/message-authorship';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import type { AgentMessage } from '$shared/types';
import { getPlainTextMessagePreview } from '$lib/components/chat/chat-message-navigation';

export interface PeopleActivityRow {
  id: string;
  name: string;
  avatarUrl: string | null;
  label: string;
  timestamp: string;
  destination: Omit<PanelTab, 'id'> | null;
  messageId: string | null;
  messagePreview: string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function messageKey(event: WorkspaceEvent): string {
  const data = record(event.data);
  const agentId = text(data.agentId) || text(event.sessionId);
  const messageId = text(data.messageId);
  return agentId && messageId ? JSON.stringify([agentId, messageId]) : '';
}

function activityDestination(event: WorkspaceEvent): PeopleActivityRow['destination'] {
  const data = record(event.data);
  const base = { workspaceId: event.workspaceId, closable: true };
  const note = (noteId: string) =>
    noteId
      ? {
          ...base,
          type: 'note' as const,
          noteId,
          title: text(data.title) || text(data.noteTitle) || m.layout_tabTypes_note_title(),
        }
      : null;
  switch (event.type as string) {
    case 'note:created':
    case 'note:updated':
    case 'comment:added':
    case 'comment:resolved':
      return note(text(data.noteId));
    case 'task:status-changed':
      return note(text(data.noteId) || text(data.linkedNoteId));
    case 'spec:updated':
    case 'goal:updated':
      return note('spec');
    case 'agent:created':
    case 'agent:renamed':
    case 'agent:restored':
    case 'agent:updated':
    case 'agent:message':
    case 'agent:user-message:sent': {
      const agentId = text(data.agentId) || text(event.sessionId);
      return agentId
        ? {
            ...base,
            type: 'agent',
            agentId,
            title: text(data.agentName) || m.layout_tabTypes_agent_title(),
          }
        : null;
    }
    case 'file:changed': {
      const filePath = text(data.path) || text(data.relativePath);
      return filePath && data.action !== 'delete'
        ? { ...base, type: 'file', filePath, title: filePath.split(/[\\/]/).pop() || filePath }
        : null;
    }
    case 'git:commit': {
      const commitHash = text(data.commit);
      const gitRootId = text(data.gitRootId);
      return commitHash
        ? {
            ...base,
            type: 'changes',
            title: m.layout_tabTypes_changes_title(),
            data: { commitHash, ...(gitRootId ? { gitRootId } : {}) },
          }
        : null;
    }
    default:
      return null;
  }
}

/** Only actions whose labels describe a human's mutation, not agent lifecycle noise. */
function activityLabel(event: WorkspaceEvent, name: string): string | null {
  const data = record(event.data);
  const stringData = Object.fromEntries(
    Object.entries(data).filter(([, value]) => typeof value === 'string'),
  );
  const withActor = (action: string) =>
    m.workspace_peopleActivity_actorAction_label({ name, action });
  // The persisted catalog also carries newer wire types such as comment:resolved.
  const eventType: string = event.type;
  switch (eventType) {
    case 'note:created':
    case 'note:updated':
    case 'note:deleted':
    case 'spec:updated':
    case 'goal:updated':
      return getActivityLabel({
        ...event,
        actor: { ...event.actor, name },
        data: stringData,
      });
    case 'agent:created':
    case 'agent:renamed':
    case 'agent:deleted':
    case 'agent:restored':
    case 'git:commit':
    case 'git:push':
    case 'git:pull':
    case 'git:branch':
    case 'git:merge':
      // Existing labels sometimes treat actor.name as the target agent. Supply
      // only target data here; the recorded human is named separately below.
      return withActor(
        getActivityLabel({
          ...event,
          actor: { ...event.actor, name: undefined },
          data: stringData,
        }),
      );
    case 'agent:updated':
      return text(data.modelId) || data.completionReportCleared === true
        ? withActor(
            getActivityLabel({
              ...event,
              actor: { ...event.actor, name: undefined },
              data,
            }),
          )
        : null;
    case 'file:changed':
      return isSourceFileActivityEvent(event)
        ? getActivityLabel({
            ...event,
            actor: { ...event.actor, name },
            data: { path: text(data.path) || text(data.relativePath), action: text(data.action) },
          })
        : null;
    case 'comment:added':
      return m.events_activity_authorCommented_label({ author: name });
    case 'comment:resolved':
      return data.resolved === false
        ? withActor(m.events_activity_reopenedCommentThread_label())
        : data.resolved === true
          ? withActor(m.events_activity_resolvedCommentThread_label())
          : null;
    case 'agent:message':
    case 'agent:user-message:sent': {
      const agent = text(data.agentName) || text(data.toAgentName);
      return withActor(
        agent
          ? m.workspace_peopleActivity_messagedAgent_label({ agent })
          : m.workspace_peopleActivity_sentMessage_label(),
      );
    }
    case 'task:status-changed':
      return withActor(
        getActivityLabel({
          ...event,
          actor: { ...event.actor, name: undefined },
          data: {
            taskName: text(data.taskName) || text(data.noteTitle),
            newStatus: text(data.newStatus) || text(data.status),
          },
        }),
      );
    case 'workspace:created':
      return withActor(m.events_activity_createdWorkspace_label());
    case 'workspace:updated': {
      if (isWorkspaceStatusUpdateEvent(event)) return null;
      const changes = record(data.changes);
      if (Object.keys(changes).filter((key) => key !== 'workspaceId').length === 0) return null;
      const title = text(changes.title);
      return withActor(
        title
          ? m.events_activity_renamedWorkspaceTo_label({ title })
          : m.events_activity_updatedWorkspace_label(),
      );
    }
    default:
      return null;
  }
}

function humanName(value: unknown, id: string): string {
  const name = text(value);
  // Legacy generic actors and unresolved principal IDs do not identify a person.
  return name === id || /^(user|you|system|unknown|anonymous|local user)$/i.test(name) ? '' : name;
}

/** Historical attribution wins; the current roster only supplies identity by stable ID. */
export function getPeopleActivity(
  workspaceId: string,
  events: readonly WorkspaceEvent[],
  people: readonly PresenceIdentity[],
  ownerPrincipalId?: string | null,
): PeopleActivityRow[] {
  const roster = new Map(people.map((person) => [person.principalId, person]));
  const previews = new Map<string, string>();
  for (const event of events) {
    if (event.workspaceId !== workspaceId || (event.type as string) !== 'agent:last-message')
      continue;
    const data = record(event.data);
    const author = getHumanMessageAuthor({
      role: data.role === 'user' ? 'user' : 'system',
      author: data.author,
      metadata: data.metadata,
    });
    const key = messageKey(event);
    if (!author || !key || typeof data.lastUserMessage !== 'string') continue;
    const preview = getPlainTextMessagePreview(
      {
        id: text(data.messageId),
        role: 'user',
        timestamp: event.timestamp,
        contentBlocks: [{ type: 'text', text: data.lastUserMessage }],
        author,
        metadata: data.metadata as AgentMessage['metadata'],
      },
      ownerPrincipalId,
    );
    if (preview) previews.set(key, preview);
  }
  const seen = new Set<string>();
  const messages = new Set<string>();
  const rows: PeopleActivityRow[] = [];
  for (const event of events) {
    if (
      event.workspaceId !== workspaceId ||
      !text(event.id) ||
      seen.has(event.id) ||
      !Number.isFinite(Date.parse(event.timestamp))
    ) {
      continue;
    }
    const data = record(event.data);
    const isMessage = event.type === 'agent:message';
    const author = isMessage
      ? getHumanMessageAuthor({
          role: data.role === 'user' ? 'user' : 'system',
          author: data.author,
          metadata: data.metadata,
        })
      : null;
    if (isMessage ? !author : event.actor?.type !== 'user') continue;
    const messageId = isMessage ? text(data.messageId) : '';
    const key = isMessage ? messageKey(event) : '';
    if (key && messages.has(key)) continue;
    const id = text(event.actor?.id);
    const person = id ? roster.get(id) : undefined;
    const name = author
      ? humanName(author.displayName, author.principalId ?? '') ||
        humanName(author.login, author.principalId ?? '')
      : humanName(event.actor.name, id) ||
        humanName(person?.displayName, id) ||
        humanName(person?.login, id);
    if (!name) continue;
    const messagePreview = isMessage ? (previews.get(key) ?? null) : null;
    const label = messagePreview
      ? m.workspace_peopleActivity_actorAction_label({ name, action: messagePreview })
      : activityLabel(event, name);
    if (!label) continue;
    seen.add(event.id);
    if (key) messages.add(key);
    rows.push({
      id: event.id,
      name,
      avatarUrl: author ? author.avatarUrl : (person?.avatarUrl ?? null),
      label,
      timestamp: event.timestamp,
      destination: activityDestination(event),
      messageId: messageId || null,
      messagePreview,
    });
  }
  return rows.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
