import { describe, expect, it } from 'vitest';
import { faTerminal } from '@fortawesome/free-solid-svg-icons';
import type { WorkspaceEvent } from '$features/events/types';
import {
  getActivityChatTarget,
  getActivityIcon,
  getActivityTitle,
  shouldShowActivityPreviewEvent,
} from '../utils';

function toolCallEvent(title: string): WorkspaceEvent {
  return {
    id: 'event-1',
    workspaceId: 'workspace-1',
    timestamp: '2026-07-27T00:00:00.000Z',
    type: 'agent:tool:call',
    actor: { type: 'agent', id: 'agent-1' },
    data: { title },
  };
}

describe('activity title display', () => {
  it('removes inline-code backticks around file names', () => {
    expect(getActivityTitle(toolCallEvent('Read `src/lib/App.svelte`'))).toBe(
      'Read src/lib/App.svelte',
    );
  });

  it('removes backticks from truncated command titles', () => {
    const title = getActivityTitle(
      toolCallEvent('Run `playwright-cli -s=theme open http://localhost:5192/very-long-path`'),
    );

    expect(title).toMatch(/^Run playwright-cli/);
    expect(title).not.toContain('`');
  });

  it('shows a compact excerpt for agent messages', () => {
    const event: WorkspaceEvent = {
      ...toolCallEvent(''),
      type: 'agent:message',
      actor: { type: 'agent', id: 'agent-1', name: 'Review agent' },
      data: {
        content:
          'Implemented the activity preview improvements and verified the focused regression suite.',
      },
    };

    expect(getActivityTitle(event)).toBe(
      'Review agent: Implemented the activity preview improvements and verified…',
    );
    expect(shouldShowActivityPreviewEvent(event)).toBe(true);
  });

  it('names completed agent activity without including report text', () => {
    const event: WorkspaceEvent = {
      ...toolCallEvent(''),
      type: 'agent:idle',
      actor: { type: 'agent', id: 'agent-1', name: 'Review agent' },
      data: {
        agentId: 'agent-1',
        agentName: 'Review agent',
        completionReport: 'Completed combined item details that should stay out of the preview.',
      },
    };

    expect(getActivityTitle(event)).toBe('Review agent finished');
    expect(getActivityTitle(event)).not.toContain('Completed combined item');
  });

  it('resolves a completed system event name from its subject agent ID', () => {
    const event: WorkspaceEvent = {
      ...toolCallEvent(''),
      type: 'agent:idle',
      actor: { type: 'system' },
      data: { agentId: 'agent-1' },
    };

    expect(getActivityTitle(event, {}, { 'agent-1': 'Review agent' })).toBe(
      'Review agent finished',
    );
  });

  it('shows the resolved script name and terminal icon for script state events', () => {
    const event: WorkspaceEvent = {
      ...toolCallEvent(''),
      type: 'script:state',
      data: { scriptId: '717bf59b-0ea9-4e52-b43f-script', status: 'running' },
    };

    expect(getActivityTitle(event, { [event.data.scriptId]: 'Development server' })).toBe(
      'Development server started',
    );
    expect(getActivityIcon(event)).toBe(faTerminal);
  });

  it('does not expose a raw script ID when definitions are not hydrated yet', () => {
    const event: WorkspaceEvent = {
      ...toolCallEvent(''),
      type: 'script:state',
      data: { scriptId: '717bf59b-0ea9-4e52-b43f-script', status: 'running' },
    };

    expect(getActivityTitle(event)).toBe('Script started');
  });

  it('hides content-free message notifications and generic active status changes', () => {
    const messageEvent: WorkspaceEvent = {
      ...toolCallEvent(''),
      type: 'agent:message',
      data: { messageId: 'message-1', role: 'assistant' },
    };
    const activeEvent: WorkspaceEvent = {
      ...toolCallEvent(''),
      type: 'agent:status-changed',
      data: { status: 'active' },
    };
    const workingEvent: WorkspaceEvent = {
      ...activeEvent,
      data: { status: 'responding' },
    };

    expect(shouldShowActivityPreviewEvent(messageEvent)).toBe(false);
    expect(shouldShowActivityPreviewEvent(activeEvent)).toBe(false);
    expect(shouldShowActivityPreviewEvent(workingEvent)).toBe(true);
  });

  it('hides workspace activity outside the focused categories', () => {
    const statusEvent: WorkspaceEvent = {
      ...toolCallEvent(''),
      type: 'workspace:updated',
      data: { changes: { statusMessage: 'Running verification.' } },
    };

    expect(shouldShowActivityPreviewEvent(statusEvent)).toBe(false);
    expect(
      shouldShowActivityPreviewEvent({
        ...statusEvent,
        type: 'workspace:displayStatus-changed',
        data: { displayStatus: 'in_progress' },
      }),
    ).toBe(false);
    expect(
      shouldShowActivityPreviewEvent({
        ...statusEvent,
        data: { changes: { statusMessage: 'Done.', title: 'Activity cleanup' } },
      }),
    ).toBe(false);
    expect(
      shouldShowActivityPreviewEvent({
        ...statusEvent,
        type: 'file:changed',
        data: { path: '.playwright-cli/console-2026.log', action: 'modify' },
      }),
    ).toBe(false);
  });

  it('resolves exact chat targets for activity navigation', () => {
    const event = toolCallEvent('Read src/lib/App.svelte');
    event.data = {
      ...event.data,
      messageId: 'message-1',
      toolCallId: 'tool-call-1',
      turnNumber: 4,
    };

    expect(getActivityChatTarget(event)).toEqual({
      messageId: 'message-1',
      toolCallId: 'tool-call-1',
      turnNumber: 4,
    });
  });
});
