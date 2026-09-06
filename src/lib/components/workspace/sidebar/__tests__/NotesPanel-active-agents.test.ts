/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

import NotesPanel from '../NotesPanel.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import type { AgentSession, Note } from '$shared/types';
import { AgentStatus, ContentType, NoteVisibility } from '$shared/types';

const workspaceId = 'notes-panel-workspace';
const agentId = 'notes-panel-agent';
const timestamp = '2026-09-03T00:00:00.000Z';

function session(): AgentSession {
  return {
    id: agentId,
    backendSessionId: 'notes-panel-backend',
    workspaceId,
    name: 'Task Worker',
    status: AgentStatus.Idle,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  } as AgentSession;
}

function taskNote(): Note {
  return {
    id: 'task-note-1',
    workspaceId,
    title: 'Implement feature',
    content: '',
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    metadata: { task: { status: 'in_progress', assignedAgentIds: [agentId] } },
    createdAt: timestamp,
    updatedAt: timestamp,
  } as Note;
}

const avatarSelector = '[data-agent-avatar-with-state]';

describe('NotesPanel active-agent row', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(bulkUpsertSessions([session()]));
  });

  afterEach(() => {
    appStore.dispatch(removeSession(agentId));
  });

  it('keeps a tool-executing assigned agent visible as running', async () => {
    const view = render(NotesPanel, { props: { notes: [taskNote()], workspaceId } });

    expect(view.container.querySelector(avatarSelector)).toBeNull();

    appStore.dispatch(
      updateSession(agentId, {
        status: AgentStatus.Active,
        isResponding: true,
        isWaitingOnTool: true,
      }),
    );

    await waitFor(() => {
      const avatar = view.container.querySelector(avatarSelector);
      expect(avatar?.getAttribute('data-avatar-state')).toBe('running');
    });
  });

  it('hides an assigned agent that is genuinely blocked on other agents', async () => {
    const view = render(NotesPanel, { props: { notes: [taskNote()], workspaceId } });

    appStore.dispatch(
      updateSession(agentId, {
        status: AgentStatus.Active,
        isResponding: true,
        isProcessing: false,
      }),
    );
    await waitFor(() =>
      expect(view.container.querySelector(avatarSelector)?.getAttribute('data-avatar-state')).toBe(
        'running',
      ),
    );

    appStore.dispatch(
      updateSession(agentId, {
        status: AgentStatus.Waiting,
        isResponding: false,
        isWaitingForOtherAgents: true,
      }),
    );
    await waitFor(() => expect(view.container.querySelector(avatarSelector)).toBeNull());
  });
});
