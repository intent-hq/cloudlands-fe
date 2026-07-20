/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { QueuedMessage } from '$shared/types';

vi.mock('../../ui/button/button.svelte', async () => ({
  default: (await import('./mocks/Button.svelte')).default,
}));

import QueuedMessageList from '../QueuedMessageList.svelte';

const WAKE_TEXT =
  '[WORKSPACE EVENTS] You have been woken up by 1 subscribed event(s):\n\n' +
  '1. [agent:idle] Agent "Foo" is now idle {{agentId:agent-foo-1}}';

function queued(overrides: Partial<QueuedMessage>): QueuedMessage {
  return {
    id: 'q-1',
    content: 'hello',
    queuedAt: '2026-01-01T00:00:00.000Z',
    position: 0,
    ...overrides,
  };
}

function buttonTooltips(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button[tooltip]')).map(
    (b) => b.getAttribute('tooltip') ?? '',
  );
}

describe('QueuedMessageList', () => {
  it('renders a regular queued message as raw text with Edit, Remove and Send now', () => {
    const { container } = render(QueuedMessageList, {
      props: { messages: [queued({ content: 'run the tests' })] },
    });

    expect(screen.getByText('run the tests')).toBeTruthy();
    const tooltips = buttonTooltips(container);
    expect(tooltips).toContain('Edit');
    expect(tooltips).toContain('Remove');
    expect(tooltips.some((t) => t.startsWith('Send now'))).toBe(true);
  });

  it('renders an event wake (messageMetadata) as a compact system row without Edit', () => {
    const message = queued({
      content: WAKE_TEXT,
      messageMetadata: {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:idle'],
        events: [
          {
            type: 'agent:idle',
            timestamp: '2026-01-01T00:00:00.000Z',
            data: {
              agentId: 'agent-foo-1',
              agentName: 'Foo',
              completionReport: 'Implemented the feature and ran tests.',
            },
          },
        ],
      },
    });
    const { container } = render(QueuedMessageList, { props: { messages: [message] } });

    // Compact label + report preview instead of the raw prefixed text
    expect(screen.getByText('Child agent Foo completed')).toBeTruthy();
    expect(screen.getByText(/Implemented the feature and ran tests\./)).toBeTruthy();
    expect(screen.queryByText(WAKE_TEXT)).toBeNull();

    // No Edit affordance; Remove and Send now stay
    const tooltips = buttonTooltips(container);
    expect(tooltips).not.toContain('Edit');
    expect(tooltips).toContain('Remove');
    expect(tooltips.some((t) => t.startsWith('Send now'))).toBe(true);
  });

  it('falls back to the [WORKSPACE EVENTS] prefix when metadata is absent', () => {
    const { container } = render(QueuedMessageList, {
      props: { messages: [queued({ content: WAKE_TEXT })] },
    });

    expect(screen.getByText('Child agent Foo completed')).toBeTruthy();
    expect(screen.queryByText(WAKE_TEXT)).toBeNull();
    expect(buttonTooltips(container)).not.toContain('Edit');
  });

  it('falls back to text parsing when messageMetadata has an unexpected shape', () => {
    const { container } = render(QueuedMessageList, {
      props: {
        messages: [
          queued({
            content: WAKE_TEXT,
            messageMetadata: { type: 'event_notification', events: 'not-an-array' },
          }),
        ],
      },
    });

    expect(screen.getByText('Child agent Foo completed')).toBeTruthy();
    expect(buttonTooltips(container)).not.toContain('Edit');
  });

  it('falls back to text parsing when metadata events items are malformed', () => {
    render(QueuedMessageList, {
      props: {
        messages: [
          queued({
            content: WAKE_TEXT,
            // events is an array, but its items lack the expected `data` object
            messageMetadata: { type: 'event_notification', events: ['agent:idle'] },
          }),
        ],
      },
    });

    expect(screen.getByText('Child agent Foo completed')).toBeTruthy();
  });

  it('keeps the requeued-after-failure indicator on event wake rows', () => {
    const { container } = render(QueuedMessageList, {
      props: { messages: [queued({ content: WAKE_TEXT, requeuedAfterFailure: true })] },
    });

    expect(screen.getByText('Child agent Foo completed')).toBeTruthy();
    expect(container.querySelector('[title="Failed — will retry"]')).toBeTruthy();
  });

  it('keeps regular messages unchanged when mixed with an event wake', () => {
    const { container } = render(QueuedMessageList, {
      props: {
        messages: [
          queued({ id: 'q-1', content: 'normal message', position: 0 }),
          queued({ id: 'q-2', content: WAKE_TEXT, position: 1 }),
        ],
      },
    });

    expect(screen.getByText('normal message')).toBeTruthy();
    expect(screen.getByText('Child agent Foo completed')).toBeTruthy();
    // Exactly one Edit button (the normal message's)
    expect(buttonTooltips(container).filter((t) => t === 'Edit')).toHaveLength(1);
  });

  it('editLastMessage() skips a trailing event wake and edits the last user message', async () => {
    const { component, container } = render(QueuedMessageList, {
      props: {
        messages: [
          queued({ id: 'q-1', content: 'normal message', position: 0 }),
          queued({ id: 'q-2', content: WAKE_TEXT, position: 1 }),
        ],
      },
    });

    expect(component.editLastMessage()).toBe(true);
    await tick();

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea?.value).toBe('normal message');
  });

  it('editLastMessage() returns false when the queue only holds event wakes', async () => {
    const { component, container } = render(QueuedMessageList, {
      props: { messages: [queued({ content: WAKE_TEXT })] },
    });

    expect(component.editLastMessage()).toBe(false);
    await tick();

    expect(container.querySelector('textarea')).toBeNull();
  });
});
