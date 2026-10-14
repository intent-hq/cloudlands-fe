import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceConversation } from './workspace-conversation';
import {
  bulkUpsertSessions,
  replaceMessages,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  chatTrackedWorkspaceSet,
  chatLiveStreamPhaseChanged,
  chatTranscriptSnapshotApplied,
  transcriptHydrationSettled,
  messageBlockHydrated,
} from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentMessage, ContentBlock } from '$shared/types';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a href="#workspace">{children}</a>,
}));
// Admission and disclosure interaction are covered in their own native/owner tests.
// This mount exercises actual message updates, canonical selectors/cache, and ToolBody rendering.
vi.mock('@/store/workspace-lifecycle/workspace-lifecycle-selectors', () => ({
  selectAdmittedWorkspaceReadContext: () => ({ value: 'test-admission' }),
}));
vi.mock('@/features/chat/components/response-group', () => ({
  ResponseGroup: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

it('uses a hydrated slim block until newer complete content arrives for the same block ID', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const dispose = store.init();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const workspaceId = WorkspaceId('cache-update-workspace');
  const agentId = AgentId('cache-update-agent');
  const block: ContentBlock = {
    id: 'tool-result',
    type: 'tool_result',
    toolName: 'Read',
    output: 'slim preview',
    outputTruncated: true,
  };
  const message: AgentMessage = {
    id: 'message',
    role: 'assistant',
    timestamp: '2026-10-14T00:00:00Z',
    contentBlocks: [block],
  };
  const settle = async () =>
    act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  try {
    store.dispatch(
      bulkUpsertSessions([
        {
          id: agentId,
          workspaceId,
          backendSessionId: null,
          name: 'Cache update',
          status: AgentStatus.Active,
          messages: [message],
          createdAt: '2026-10-14T00:00:00Z',
          updatedAt: '2026-10-14T00:00:00Z',
        },
      ]),
    );
    store.dispatch(chatTrackedWorkspaceSet(agentId, workspaceId));
    store.dispatch(chatTranscriptSnapshotApplied(agentId, { truncated: false, totalMessages: 1 }));
    store.dispatch(chatLiveStreamPhaseChanged(agentId, 'live'));
    store.dispatch(transcriptHydrationSettled(agentId));
    await act(async () =>
      root.render(<WorkspaceConversation workspaceId={workspaceId} agentId={agentId} />),
    );
    await act(async () => {
      store.dispatch(
        messageBlockHydrated(agentId, message.id, block.id!, {
          ...block,
          output: 'cached full A',
          outputTruncated: false,
        }),
      );
    });
    await settle();
    expect(container.querySelector('[data-block-id="tool-result"] pre')?.textContent).toBe(
      '"cached full A"',
    );
    await act(async () => {
      store.dispatch(
        replaceMessages(agentId, [
          {
            ...message,
            contentBlocks: [{ ...block, output: 'current complete B', outputTruncated: false }],
          },
        ]),
      );
    });
    await settle();
    const body = container.querySelector('[data-block-id="tool-result"]');
    expect(body?.getAttribute('data-hydration')).toBe('complete');
    expect(body?.querySelector('pre')?.textContent).toBe('"current complete B"');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dispose();
    vi.unstubAllGlobals();
  }
});
