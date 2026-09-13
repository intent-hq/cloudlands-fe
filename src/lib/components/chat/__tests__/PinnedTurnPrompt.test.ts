/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { store as appStore } from '$store/renderer/store';
import type { AgentMessage } from '$shared/types';
import PinnedTurnPrompt from '../PinnedTurnPrompt.svelte';

beforeAll(() => appStore.init());
afterEach(cleanup);

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
      const button = screen.getByRole('button') as HTMLButtonElement;
      expect(button.title).toContain(label);
      expect(button.title).not.toMatch(
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
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.title).toContain('New watch');
    expect(button.title).not.toContain('First human prompt');
    await fireEvent.keyDown(button, { key: 'Enter' });
    await fireEvent.keyDown(button, { key: ' ' });
    expect(onActivate).toHaveBeenCalledTimes(2);
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

  it('preserves attachment-only context and Chief attribution across updates', async () => {
    const onActivate = vi.fn();
    const source = message('');
    source.contentBlocks = [
      {
        type: 'file',
        fileName: 'layout-reference.txt',
        mimeType: 'text/plain',
        url: 'file:///layout-reference.txt',
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
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.title).toContain('Continue the review');
    expect(button.title).not.toContain('layout-reference.txt');
    await fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledOnce();
  });
});
