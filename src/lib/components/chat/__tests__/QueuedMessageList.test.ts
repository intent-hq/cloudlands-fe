/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { QueuedMessage } from '$shared/types';

vi.mock('../../ui/button/button.svelte', async () => ({
  default: (await import('./mocks/Button.svelte')).default,
}));

vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./mocks/AuggieAvatar.svelte')).default,
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

  it('renders a reportToParent wake as a completion with the report as preview', () => {
    const message = queued({
      content:
        '[WORKSPACE EVENTS] Child agent Foo (agent-foo-1) completed. Report: Opened PR #410 and all checks pass.',
      messageMetadata: {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:reportToParent'],
        events: [
          {
            type: 'agent:reportToParent',
            timestamp: '2026-01-01T00:00:00.000Z',
            data: {
              agentId: 'agent-foo-1',
              agentName: 'Foo',
              report: 'Opened PR #410 and all checks pass.',
            },
          },
        ],
      },
    });
    const { container } = render(QueuedMessageList, { props: { messages: [message] } });

    expect(screen.getByText('Child agent Foo completed')).toBeTruthy();
    expect(screen.getByText(/Opened PR #410 and all checks pass\./)).toBeTruthy();
    expect(buttonTooltips(container)).not.toContain('Edit');
  });

  it('reads the legacy data.report key as the preview for agent:idle wakes', () => {
    render(QueuedMessageList, {
      props: {
        messages: [
          queued({
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
                    report: 'Fixed the flaky test and reran the suite.',
                  },
                },
              ],
            },
          }),
        ],
      },
    });

    expect(screen.getByText('Child agent Foo completed')).toBeTruthy();
    expect(screen.getByText(/Fixed the flaky test and reran the suite\./)).toBeTruthy();
  });

  it('strips the [WORKSPACE EVENTS] prefix as the preview for single-line wakes without metadata', () => {
    render(QueuedMessageList, {
      props: {
        messages: [
          queued({
            content:
              '[WORKSPACE EVENTS] Child agent Foo (agent-foo-1) completed. Report: Did the thing.',
            messageMetadata: { type: 'event_notification', eventCount: 1 },
          }),
        ],
      },
    });

    expect(screen.getByText('1 workspace event')).toBeTruthy();
    expect(
      screen.getByText(/Child agent Foo \(agent-foo-1\) completed\. Report: Did the thing\./),
    ).toBeTruthy();
  });

  it('labels a non-agent event wake with categories derived from eventTypes', () => {
    const { container } = render(QueuedMessageList, {
      props: {
        messages: [
          queued({
            content: '[WORKSPACE EVENTS] You have been woken up by 3 subscribed event(s):',
            messageMetadata: {
              type: 'event_notification',
              eventCount: 3,
              eventTypes: ['file:modified', 'task:updated', 'note:updated'],
            },
          }),
        ],
      },
    });

    expect(screen.getByText('file changes · task updates · note changes')).toBeTruthy();
    expect(buttonTooltips(container)).not.toContain('Edit');
  });

  it('combines agent labels with non-agent categories for mixed event wakes', () => {
    render(QueuedMessageList, {
      props: {
        messages: [
          queued({
            content: WAKE_TEXT,
            messageMetadata: {
              type: 'event_notification',
              eventCount: 2,
              eventTypes: ['agent:idle', 'file:modified'],
              events: [
                {
                  type: 'agent:idle',
                  timestamp: '2026-01-01T00:00:00.000Z',
                  data: { agentId: 'agent-foo-1', agentName: 'Foo' },
                },
              ],
            },
          }),
        ],
      },
    });

    expect(screen.getByText('Child agent Foo completed · file changes')).toBeTruthy();
  });

  it('falls back to an event count when no categories can be derived', () => {
    render(QueuedMessageList, {
      props: {
        messages: [
          queued({
            content: '[WORKSPACE EVENTS] You have been woken up by 4 subscribed event(s):',
            messageMetadata: {
              type: 'event_notification',
              eventCount: 4,
              eventTypes: ['mystery:thing', 'other:thing'],
            },
          }),
        ],
      },
    });

    expect(screen.getByText('4 workspace events')).toBeTruthy();
    expect(screen.queryByText('Workspace events')).toBeNull();
  });

  it('shows a content-derived preview for legacy no-metadata wakes', () => {
    render(QueuedMessageList, {
      props: {
        messages: [
          queued({
            content:
              '[WORKSPACE EVENTS] You have been woken up by 2 subscribed event(s):\n\n' +
              '1. [file:modified] src/lib/foo.ts changed\n' +
              '2. [file:created] src/lib/bar.ts created',
          }),
        ],
      },
    });

    expect(screen.getByText('2 workspace events')).toBeTruthy();
    expect(screen.getByText(/\[file:modified\] src\/lib\/foo\.ts changed/)).toBeTruthy();
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

  describe('agent-to-agent messages (messageMetadata.type === "agent_message")', () => {
    const AGENT_MESSAGE_METADATA = {
      type: 'agent_message',
      fromAgentId: 'agent-sender-1',
      fromAgentName: 'Builder',
    };

    it('renders avatar + sender name attribution without Edit, keeping Remove and Send now', () => {
      const { container } = render(QueuedMessageList, {
        props: {
          messages: [
            queued({ content: 'please review my PR', messageMetadata: AGENT_MESSAGE_METADATA }),
          ],
        },
      });

      expect(screen.getByText('Builder')).toBeTruthy();
      expect(screen.getByText(/please review my PR/)).toBeTruthy();
      const avatar = screen.getByTestId('auggie-avatar');
      expect(avatar.getAttribute('data-agent-id')).toBe('agent-sender-1');

      const tooltips = buttonTooltips(container);
      expect(tooltips).not.toContain('Edit');
      expect(tooltips).toContain('Remove');
      expect(tooltips.some((t) => t.startsWith('Send now'))).toBe(true);
    });

    it('falls back to "Agent" when fromAgentName is absent', () => {
      render(QueuedMessageList, {
        props: {
          messages: [
            queued({
              content: 'hello',
              messageMetadata: { type: 'agent_message', fromAgentId: 'agent-sender-2' },
            }),
          ],
        },
      });

      expect(screen.getByText('Agent')).toBeTruthy();
    });

    it('renders as a normal editable message when metadata is malformed', () => {
      const { container } = render(QueuedMessageList, {
        props: {
          messages: [
            queued({
              content: 'hello',
              // agent_message without a usable fromAgentId
              messageMetadata: { type: 'agent_message', fromAgentId: 42 },
            }),
          ],
        },
      });

      expect(screen.getByText('hello')).toBeTruthy();
      expect(screen.queryByTestId('queued-agent-message-avatar')).toBeNull();
      expect(buttonTooltips(container)).toContain('Edit');
    });

    it('editLastMessage() skips a trailing agent message and edits the last user message', async () => {
      const { component, container } = render(QueuedMessageList, {
        props: {
          messages: [
            queued({ id: 'q-1', content: 'normal message', position: 0 }),
            queued({
              id: 'q-2',
              content: 'agent says hi',
              position: 1,
              messageMetadata: AGENT_MESSAGE_METADATA,
            }),
          ],
        },
      });

      expect(component.editLastMessage()).toBe(true);
      await tick();

      const textarea = container.querySelector('textarea');
      expect(textarea).toBeTruthy();
      expect(textarea?.value).toBe('normal message');
    });

    it('keeps the requeued-after-failure indicator on agent message rows', () => {
      const { container } = render(QueuedMessageList, {
        props: {
          messages: [
            queued({
              content: 'hello',
              messageMetadata: AGENT_MESSAGE_METADATA,
              requeuedAfterFailure: true,
            }),
          ],
        },
      });

      expect(screen.getByText('Builder')).toBeTruthy();
      expect(container.querySelector('[title="Failed — will retry"]')).toBeTruthy();
    });
  });

  describe('image thumbnails', () => {
    const IMAGE_BLOCKS: NonNullable<QueuedMessage['imageBlocks']> = [
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' },
    ];

    function thumbnails(container: HTMLElement): HTMLButtonElement[] {
      return Array.from(
        container.querySelectorAll<HTMLButtonElement>('[data-testid="queued-image-thumbnail"]'),
      );
    }

    it('renders one thumbnail per image block with the data-URL src', () => {
      const { container } = render(QueuedMessageList, {
        props: { messages: [queued({ content: 'look at these', imageBlocks: IMAGE_BLOCKS })] },
      });

      const buttons = thumbnails(container);
      expect(buttons).toHaveLength(2);
      const imgs = buttons.map((b) => b.querySelector('img'));
      expect(imgs[0]?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
      expect(imgs[1]?.getAttribute('src')).toBe('data:image/jpeg;base64,BBBB');
      expect(buttons[0].getAttribute('aria-label')).toBe('View attached image 1 of 2 full size');
      expect(screen.getByText('look at these')).toBeTruthy();
    });

    it('renders no thumbnails when imageBlocks is absent or empty', () => {
      const { container } = render(QueuedMessageList, {
        props: {
          messages: [
            queued({ id: 'q-1', content: 'no images', position: 0 }),
            queued({ id: 'q-2', content: 'empty images', position: 1, imageBlocks: [] }),
          ],
        },
      });

      expect(thumbnails(container)).toHaveLength(0);
      expect(container.querySelector('[data-testid="queued-image-thumbnail"] img')).toBeNull();
    });

    it('clicking a thumbnail opens the lightbox and does not start edit mode', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const { container } = render(QueuedMessageList, {
        props: { messages: [queued({ content: 'with image', imageBlocks: IMAGE_BLOCKS })], onedit },
      });

      await fireEvent.click(thumbnails(container)[1]);
      await tick();

      // Lightbox opened (portaled to body) with the clicked image
      const dialog = document.body.querySelector('[role="dialog"][aria-label="Image preview"]');
      expect(dialog).toBeTruthy();
      const lightboxImg = dialog?.querySelector('img');
      expect(lightboxImg?.getAttribute('src')).toBe('data:image/jpeg;base64,BBBB');
      expect(lightboxImg?.getAttribute('alt')).toBe('Attached image 2');

      // Edit mode not triggered
      expect(container.querySelector('textarea')).toBeNull();
      expect(onedit).not.toHaveBeenCalled();
    });

    it('offers no remove or edit affordance for images', () => {
      const { container } = render(QueuedMessageList, {
        props: { messages: [queued({ content: 'with image', imageBlocks: IMAGE_BLOCKS })] },
      });

      // Only the row-level Remove/Edit buttons exist; none per image
      const tooltips = buttonTooltips(container);
      expect(tooltips.filter((t) => t === 'Remove')).toHaveLength(1);
      expect(tooltips.filter((t) => t === 'Edit')).toHaveLength(1);
      // Every thumbnail button is a view-only affordance
      for (const button of thumbnails(container)) {
        expect(button.getAttribute('aria-label')).toMatch(
          /^View attached image \d+ of \d+ full size$/,
        );
      }
    });

    it('renders thumbnails on agent-to-agent attribution rows', () => {
      const { container } = render(QueuedMessageList, {
        props: {
          messages: [
            queued({
              content: 'from an agent',
              imageBlocks: [IMAGE_BLOCKS[0]],
              messageMetadata: {
                type: 'agent_message',
                fromAgentId: 'agent-sender-1',
                fromAgentName: 'Builder',
              },
            }),
          ],
        },
      });

      expect(screen.getByText('Builder')).toBeTruthy();
      const buttons = thumbnails(container);
      expect(buttons).toHaveLength(1);
      expect(buttons[0].querySelector('img')?.getAttribute('src')).toBe(
        'data:image/png;base64,AAAA',
      );
    });
  });

  describe('held-for-questions hint', () => {
    const hint = (container: HTMLElement) =>
      container.querySelector('[data-testid="queued-messages-held-hint"]');

    it('renders the singular hint when one message is held', () => {
      const { container } = render(QueuedMessageList, {
        props: { messages: [queued({})], heldForQuestions: true },
      });

      expect(hint(container)?.textContent).toContain(
        "1 message waiting — held until you answer or dismiss the agent's questions",
      );
    });

    it('renders the plural hint with the queue count', () => {
      const { container } = render(QueuedMessageList, {
        props: {
          messages: [queued({ id: 'q-1' }), queued({ id: 'q-2', content: 'second' })],
          heldForQuestions: true,
        },
      });

      expect(hint(container)?.textContent).toContain(
        "2 messages waiting — held until you answer or dismiss the agent's questions",
      );
    });

    it('omits the hint when the queue is not held', () => {
      const { container } = render(QueuedMessageList, {
        props: { messages: [queued({})] },
      });

      expect(hint(container)).toBeNull();
    });
  });
});
