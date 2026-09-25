/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { store as appStore } from '$store/renderer/store';
import type { AgentMessage, Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { handleLink } from '$features/navigation/link-handler';
import PinnedTurnPrompt from '../PinnedTurnPrompt.svelte';

vi.mock('$features/navigation/link-handler', () => ({ handleLink: vi.fn() }));
vi.mock('$lib/utils/workspace-route-context', () => ({
  getWorkspaceRouteContext: () => ({ workspaceId: 'workspace-pinned-parity' }),
}));

beforeAll(() => appStore.init());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function returnButton() {
  return screen
    .getAllByRole('button', { name: m.chat_stickyMessageHeader_scrollToPrevious_title() })
    .at(-1)!;
}

function message(text: string, metadata?: Record<string, unknown>): AgentMessage {
  return {
    id: 'trigger',
    role: 'user',
    timestamp: new Date('2026-09-10T00:00:00Z'),
    contentBlocks: [{ type: 'text', text }],
    metadata,
  };
}

describe('pinned response trigger', () => {
  it.each([
    ['human', message('Please check the layout'), 'Please check the layout'],
    [
      'agent',
      message('[MESSAGE FROM AGENT Verifier (agent-abcd)]\n\nThe review is ready', {
        type: 'agent_message',
        fromAgentId: 'agent-abcd',
        fromAgentName: 'Verifier',
      }),
      'Verifier',
    ],
    [
      'hook',
      message('[Background hook "Build watch"] Tests passed', {
        type: 'hook_wake',
        hookId: 'hook-1',
        hookName: 'Build watch',
        reason: 'dispatched',
      }),
      'Build watch',
    ],
    ['legacy hook', message('[Background hook "Legacy watch"] Tests passed'), 'Legacy watch'],
    ['PR', message('[PR monitor intent-hq/intent#42] Checks passed'), 'intent-hq/intent #42'],
    [
      'event',
      message('[WORKSPACE EVENTS]\nRaw dispatch payload', {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:idle'],
        events: [
          {
            type: 'agent:idle',
            data: { agentName: 'Browser verifier' },
            timestamp: '2026-09-10T00:00:00Z',
          },
        ],
      }),
      'Browser verifier',
    ],
    [
      'legacy event',
      message(
        '[WORKSPACE EVENTS]\n1. [agent:idle] Child agent Legacy verifier (agent-abcd) finished',
      ),
      'Legacy verifier',
    ],
  ] as const)(
    'returns to the original %s source rather than opening a disclosure',
    async (_kind, source, label) => {
      const onActivate = vi.fn();
      render(PinnedTurnPrompt, { props: { message: source, onActivate } });
      const button = returnButton();
      const surface = screen.getByTestId('pinned-user-prompt');
      expect(surface.title).toContain(label);
      expect(surface.title).not.toMatch(
        /\[WORKSPACE EVENTS\]|\[MESSAGE FROM AGENT|\[Background hook|\[PR monitor/,
      );
      await fireEvent.click(button);
      expect(onActivate).toHaveBeenCalledOnce();
      expect(button.hasAttribute('aria-expanded')).toBe(false);
      expect(screen.queryByTestId('event-wakeup-details')).toBeNull();
    },
  );

  it('updates the pinned summary when a different trigger takes over', async () => {
    const onActivate = vi.fn();
    const view = render(PinnedTurnPrompt, {
      props: { message: message('First human prompt'), onActivate },
    });
    await view.rerender({
      message: message('[Background hook "New watch"] New result'),
      onActivate,
    });
    const surface = screen.getByTestId('pinned-user-prompt');
    expect(surface.title).toContain('New watch');
    expect(surface.title).not.toContain('First human prompt');
    await fireEvent.click(returnButton());
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('keeps queued delivery annotations out of the compact context', () => {
    render(PinnedTurnPrompt, {
      props: {
        message: message(
          'Review the result\n\n[SYSTEM NOTE] This message was queued at 2026-09-10T00:00:00.000Z and waited 3s before delivery.',
          {
            queueInfo: { queuedAt: '2026-09-10T00:00:00.000Z', waitedMs: 3000 },
          },
        ),
        onActivate: vi.fn(),
      },
    });
    expect((screen.getByRole('button') as HTMLButtonElement).title).toBe('Review the result');
  });

  it('preserves reference-attachment context and Chief attribution across updates', async () => {
    const onActivate = vi.fn();
    const source = message('');
    source.contentBlocks = [
      {
        type: 'file',
        attachmentId: 'attachment-layout-reference',
        fileName: 'layout-reference.txt',
        mimeType: 'text/plain',
      },
    ];
    const view = render(PinnedTurnPrompt, { props: { message: source, onActivate } });
    expect((screen.getByRole('button') as HTMLButtonElement).title).toBe('layout-reference.txt');
    await view.rerender({
      message: message('Continue the review', {
        type: 'chief_message',
        fromAgentId: 'agent-chief',
      }),
      onActivate,
    });
    const surface = screen.getByTestId('pinned-user-prompt');
    expect(surface.title).not.toContain('Continue the review');
    expect(surface.title).not.toContain('layout-reference.txt');
    await fireEvent.click(returnButton());
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it.each([
    ['agent', { type: 'agent_message', fromAgentId: 'sender', fromAgentName: 'Builder' }],
    [
      'chief source',
      {
        type: 'chief_message',
        fromAgentId: 'agent-chief',
        fromWorkspaceId: '__chief__',
        sourceMessageId: 'source-message',
        sourceUrl: 'intent://local/__chief__/agent/agent-chief/message/source-message',
      },
    ],
    ['PR', { type: 'pr_monitor_wake', repo: 'intent-hq/intent', prNumber: 42 }],
    ['hook', { type: 'hook_wake', hookId: 'watch', hookName: 'Build watch', reason: 'dispatched' }],
    [
      'event avatar',
      {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:idle'],
        events: [
          {
            type: 'agent:idle',
            data: { agentId: 'sender', agentName: 'Builder' },
            timestamp: '2026-09-16T12:00:00Z',
          },
        ],
      },
    ],
  ] as const)(
    'keeps %s details hidden and routes every pinned action only to its source',
    async (_kind, metadata) => {
      const onActivate = vi.fn();
      const body = 'Private detail must remain expanded-only';
      const view = render(PinnedTurnPrompt, {
        props: {
          message: message(body, metadata),
          onActivate,
          workspace: { id: 'workspace-pinned-parity' } as Workspace,
        },
      });
      const dispatch = vi.spyOn(appStore, 'dispatch');
      vi.mocked(handleLink).mockClear();
      expect(view.container.textContent).not.toContain(body);
      expect(screen.getByTestId('pinned-user-prompt').title).not.toContain(body);
      const buttons = screen.getAllByRole('button');
      for (const button of buttons) {
        await fireEvent.click(button, { ctrlKey: true });
        expect(button.hasAttribute('aria-expanded')).toBe(false);
        expect(button.hasAttribute('aria-controls')).toBe(false);
      }
      expect(onActivate).toHaveBeenCalledTimes(buttons.length);
      expect(screen.queryByRole('link')).toBeNull();
      expect(dispatch).not.toHaveBeenCalled();
      expect(handleLink).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'legacy inline file',
      { type: 'file', fileName: 'layout-reference.txt', mimeType: 'text/plain', data: 'aGVsbG8=' },
    ],
    ['daemon-projected legacy file', { type: 'text', text: 'Attached file: layout-reference.txt' }],
  ] as const)(
    'preserves the served context for a %s when pinning and navigating',
    async (_kind, block) => {
      const onActivate = vi.fn();
      const source = message('');
      source.contentBlocks = [block];
      const original = structuredClone(source);
      const view = render(PinnedTurnPrompt, { props: { message: source, onActivate } });
      const button = screen.getByRole('button') as HTMLButtonElement;

      // Mirrors the daemon's legacy-file text projection, not a filename-only attachment reference.
      expect(button.title).toBe('Attached file: layout-reference.txt');
      expect(source).toEqual(original);
      await fireEvent.click(button);
      expect(onActivate).toHaveBeenCalledOnce();

      await view.rerender({ message: message('Continue the review'), onActivate });
      expect(button.title).toBe('Continue the review');
      expect(button.title).not.toContain('layout-reference.txt');
    },
  );
});
