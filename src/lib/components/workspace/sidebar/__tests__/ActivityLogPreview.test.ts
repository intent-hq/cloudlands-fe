import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceEvent } from '$features/events/types';
import ActivityLogPreview from '../ActivityLogPreview.svelte';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

vi.mock('$features/agent/components/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));

function makeEvent(index: number): WorkspaceEvent {
  return {
    id: `event-${index}`,
    workspaceId: 'workspace-1',
    timestamp: new Date(Date.UTC(2026, 7, 3, 12, index)).toISOString(),
    type: 'agent:message',
    actor: { type: 'system' },
    data: { content: `Activity ${index}` },
  };
}

describe('ActivityLogPreview', () => {
  it('affirms the latest activity preview in every required visual state', async () => {
    const event: WorkspaceEvent = {
      ...makeEvent(0),
      type: 'agent:idle',
      data: { agentName: 'Review agent' },
    };
    const observed = await exerciseVisualStates(() => {
      const view = render(ActivityLogPreview, { props: { events: [event] } });
      const target = view.container.querySelector<HTMLElement>('[data-activity-preview-item]')!;
      target.tabIndex = 0;
      return {
        ...view,
        target,
        assertCapability: () => expect(target.textContent).toContain('Review agent finished'),
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('renders completed agent activity with the agent name', () => {
    const event: WorkspaceEvent = {
      ...makeEvent(0),
      type: 'agent:idle',
      actor: { type: 'system' },
      data: {
        agentName: 'Review agent',
        completionReport: 'Completed combined item details that should not appear.',
      },
    };
    const { container } = render(ActivityLogPreview, { props: { events: [event] } });
    const row = container.querySelector('[data-activity-preview-item]');

    expect(row?.textContent).toContain('finished');
    expect(row?.textContent).toContain('Review agent');
    expect(row?.textContent).not.toContain('Completed combined item');
  });

  it('resolves the agent name when a completed event only carries an agent ID', () => {
    const event: WorkspaceEvent = {
      ...makeEvent(0),
      type: 'agent:idle',
      actor: { type: 'system' },
      data: { agentId: 'agent-1' },
    };
    const { container } = render(ActivityLogPreview, {
      props: { events: [event], agentNames: { 'agent-1': 'Review agent' } },
    });

    expect(container.querySelector('[data-activity-preview-item]')?.textContent).toContain(
      'Review agent finished',
    );
  });

  it('strictly caps a non-expandable preview at the requested item count', () => {
    const events = Array.from({ length: 5 }, (_, index) => makeEvent(index));
    const { container } = render(ActivityLogPreview, {
      props: { events, maxItems: 3, expandable: false },
    });

    expect(container.querySelectorAll('[data-activity-preview-item]')).toHaveLength(3);
    expect(container.textContent).not.toContain('Show more');
  });

  it('reveals and collapses activity beyond the requested item count', async () => {
    const events = Array.from({ length: 5 }, (_, index) => makeEvent(index));
    const { container } = render(ActivityLogPreview, {
      props: { events, maxItems: 3 },
    });

    expect(container.querySelectorAll('[data-activity-preview-item]')).toHaveLength(3);

    await fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(container.querySelectorAll('[data-activity-preview-item]')).toHaveLength(5);

    await fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-activity-preview-item]')).toHaveLength(3);
    });
  });

  it('renders the agent avatar action as a keyboard-accessible sibling control', async () => {
    const event: WorkspaceEvent = {
      ...makeEvent(0),
      type: 'agent:idle',
      data: { agentId: 'agent-1', agentName: 'Review agent' },
    };
    const onShowAgent = vi.fn();
    const { container } = render(ActivityLogPreview, {
      props: { events: [event], onShowAgent },
    });

    const item = container.querySelector('[data-activity-preview-item]')!;
    const avatarAction = screen.getByRole('button', { name: 'Open agent' });
    const rowAction = item.querySelector(':scope > button');
    expect(avatarAction.closest('[data-activity-preview-item]')).toBe(item);
    expect(rowAction?.parentElement).toBe(item);
    expect(avatarAction.contains(rowAction)).toBe(false);
    expect(rowAction?.contains(avatarAction)).toBe(false);

    avatarAction.focus();
    expect(document.activeElement).toBe(avatarAction);
    await fireEvent.click(avatarAction);
    expect(onShowAgent).toHaveBeenCalledWith('agent-1', event);
  });

  it('routes mounted file, note, and agent rows only through their exact callbacks', async () => {
    const file = { ...makeEvent(1), type: 'file:changed', data: { path: 'src/file.ts' } };
    const note = { ...makeEvent(2), type: 'note:updated', data: { noteId: 'note-1' } };
    const agent = {
      ...makeEvent(3),
      type: 'agent:idle',
      data: { agentId: 'agent-1', agentName: 'Review agent' },
    };
    const inert = makeEvent(4);
    const onOpenFileEvent = vi.fn();
    const onOpenNote = vi.fn();
    const onShowAgent = vi.fn();
    const { container } = render(ActivityLogPreview, {
      props: {
        events: [file, note, agent, inert] as WorkspaceEvent[],
        maxItems: 4,
        onOpenFileEvent,
        onOpenNote,
        onShowAgent,
      },
    });
    const actions = container.querySelectorAll<HTMLButtonElement>(
      '[data-activity-preview-item] > button',
    );

    await fireEvent.click(actions[0]);
    await fireEvent.click(actions[1]);
    await fireEvent.click(actions[2]);
    expect(actions[3].disabled).toBe(true);
    expect(onOpenFileEvent).toHaveBeenCalledWith(file);
    expect(onOpenNote).toHaveBeenCalledWith('note-1');
    expect(onShowAgent).toHaveBeenCalledWith('agent-1', agent);
  });
});
