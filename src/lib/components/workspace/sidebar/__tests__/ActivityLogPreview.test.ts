import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceEvent } from '$features/events/types';
import ActivityLogPreview from '../ActivityLogPreview.svelte';

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
});
