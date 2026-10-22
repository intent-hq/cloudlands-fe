/**
 * @vitest-environment jsdom
 *
 * A `provider_failover` row reaches ChatMessage through the turn body stream
 * (between the failed attempt and its retry); it must render as the inline
 * failover notice, never as a message bubble.
 */
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type { AgentMessage } from '$shared/types';

let mockStoreState: Record<string, unknown> = {};

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mockStoreState });
});

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: Object.assign(
    () => ({
      subscribe: (run: (value: unknown[]) => void) => {
        run([]);
        return () => {};
      },
    }),
    { select: () => [] },
  ),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentMessageById: Object.assign(
    () => ({
      subscribe: (run: (value: unknown) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));

import ChatMessage from '../ChatMessage.svelte';
import AgentMessageList from '../AgentMessageList.svelte';

/** Global catalog without the `pwork` profile; the `ws-1` catalog still has it. */
function workspaceCatalogState(): Record<string, unknown> {
  return {
    providerCatalog: {
      loaded: true,
      providers: createCollection('id', [{ id: 'claude-code', displayName: 'Claude Code' }]),
      profiles: createCollection('id', []),
      byWorkspaceId: {
        'ws-1': {
          catalog: {
            providers: [{ id: 'claude-code', displayName: 'Claude Code' }],
            profiles: [
              {
                id: 'pwork',
                providerRef: 'claude-code@pwork',
                baseProviderId: 'claude-code',
                name: 'Work',
              },
            ],
          },
        },
      },
    },
  };
}

const DAEMON_TEXT = 'claude-code ran out of quota. Switched to the backup claude-code (Work).';

function failoverRow(metadata: Record<string, unknown>): AgentMessage {
  return {
    id: 'failover-1',
    role: 'system',
    contentBlocks: [{ type: 'text', text: DAEMON_TEXT }],
    timestamp: new Date('2026-10-21T12:00:00Z'),
    metadata: { type: 'provider_failover', ...metadata },
  } as AgentMessage;
}

describe('ChatMessage — provider_failover row', () => {
  it('renders the inline failover notice instead of a bubble', () => {
    const { container } = render(ChatMessage, {
      props: {
        message: failoverRow({
          fromProvider: 'claude-code',
          toProvider: 'claude-code@pwork',
          model: 'opus',
          reason: 'quota-exceeded',
        }),
      },
    });
    const notice = screen.getByRole('status');
    expect(notice.textContent?.trim()).toMatch(/ran out of quota — continuing on .+ \(backup\)$/);
    expect(notice.textContent).not.toContain('@pwork');
    // Nothing renders outside the notice: no bubble, no daemon text, no actions.
    expect(container.textContent?.trim()).toBe(notice.textContent?.trim());
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the daemon text inside the notice when the metadata is incomplete', () => {
    const { container } = render(ChatMessage, { props: { message: failoverRow({}) } });
    const notice = screen.getByRole('status');
    expect(notice.textContent?.trim()).toBe(DAEMON_TEXT);
    expect(container.textContent?.trim()).toBe(DAEMON_TEXT);
    expect(screen.queryByRole('button')).toBeNull();
  });

  describe('labels from the owning workspace catalog', () => {
    // The global catalog no longer has the backup profile; the workspace's own
    // catalog (what the agent actually runs against) still does.
    beforeEach(() => {
      mockStoreState = workspaceCatalogState();
    });

    const row = () =>
      failoverRow({
        fromProvider: 'claude-code',
        toProvider: 'claude-code@pwork',
        model: 'opus',
        reason: 'quota-exceeded',
      });

    it('ChatMessage names the backup from its workspace catalog', () => {
      render(ChatMessage, {
        props: { message: row(), workspace: { id: 'ws-1' } as never },
      });
      const text = screen.getByRole('status').textContent ?? '';
      expect(text).toContain('continuing on Work (backup)');
      expect(text).not.toContain('Removed profile');
    });

    it('AgentMessageList names the backup from its workspace catalog', () => {
      render(AgentMessageList, {
        props: { messages: [row()], workspaceId: 'ws-1', enableTransitions: false },
      });
      const text = screen.getByRole('status').textContent ?? '';
      expect(text).toContain('continuing on Work (backup)');
      expect(text).not.toContain('Removed profile');
    });
  });

  describe('provider_returned row', () => {
    beforeEach(() => {
      mockStoreState = workspaceCatalogState();
    });

    const returnedRow = (): AgentMessage =>
      ({
        id: 'returned-1',
        role: 'system',
        contentBlocks: [{ type: 'text', text: 'Back on claude-code (Work).' }],
        timestamp: new Date('2026-10-21T12:00:00Z'),
        metadata: {
          type: 'provider_returned',
          fromProvider: 'claude-code@pother',
          toProvider: 'claude-code@pwork',
          model: 'opus',
          reason: 'quota-reset',
        },
      }) as AgentMessage;

    it('ChatMessage renders only the returned notice, labelled from the workspace catalog', () => {
      const { container } = render(ChatMessage, {
        props: { message: returnedRow(), workspace: { id: 'ws-1' } as never },
      });
      const notice = screen.getByRole('status');
      expect(notice.textContent?.trim()).toBe('Work quota reset — back on Work');
      expect(container.textContent?.trim()).toBe(notice.textContent?.trim());
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('AgentMessageList renders it once as a notice', () => {
      render(AgentMessageList, {
        props: { messages: [returnedRow()], workspaceId: 'ws-1', enableTransitions: false },
      });
      const notices = screen.getAllByRole('status');
      expect(notices).toHaveLength(1);
      expect(notices[0].textContent?.trim()).toBe('Work quota reset — back on Work');
    });
  });
});
