/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { store } from '$store/renderer/store';
import { AgentStatus, type AgentSession, type Workspace } from '$shared/types';
import { createAdmittedLegacyPrincipal } from '../../../../test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { transcriptHydrationSettled } from '$store/renderer/slices/chat-state/chat-state-slice';
import { setComposerContextItems } from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { selectComposerContextItems } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
import {
  setWorkspace as setMultiPanelWorkspace,
  updatePanels,
} from '$store/renderer/slices/multi-panel-context/multi-panel-context-slice';
import { selectCheckedPanels } from '$store/renderer/slices/multi-panel-context/multi-panel-context-selectors';
import type { SendMessagePayload } from '$store/renderer/slices/chat-state/chat-state-types';
import {
  installMockBackend,
  resetMockBackend,
} from '../../../../test/mocks/backend-transport.mock';
import ChatPanel from '../ChatPanel.svelte';

/**
 * Regression (cloudlands-fe#697): selecting a suggested prompt sends ONLY the
 * prompt text and leaves the composer intact. Renders the real ChatPanel so
 * the handler wiring itself is covered, not a mirror of it.
 */

vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
vi.mock('$features/workspace/workspace-detail-hydration', () => ({
  ensureWorkspaceDetail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/FaIcon.svelte')).default }));
vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('./mocks/Button.svelte')).default,
}));
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/MockSimpleRichInput.svelte')).default,
}));
vi.mock('../ChatMessage.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentCard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentSubscriptions.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../MonitoredScriptsRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AuroraBackground.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

const workspace = { id: 'suggested-ws', title: 'Suggested', myRole: 'owner' } as Workspace;
const agentId = 'suggested-agent';
const PROMPT = 'Run the tests';
let dispose: () => void;

const attachment = {
  id: 'file-upload-1-cat.png',
  type: 'file' as const,
  label: 'cat.png',
  imageData: 'aGVsbG8=',
  imageMimeType: 'image/png',
};
const checkedNotePanel = {
  id: 'panel-1:tab-1',
  panelId: 'panel-1',
  tabId: 'tab-1',
  type: 'note' as const,
  label: 'Spec',
  noteId: 'spec',
  checked: true,
};

function session(): AgentSession {
  return {
    id: agentId,
    workspaceId: workspace.id,
    name: 'Agent',
    status: AgentStatus.Idle,
    messages: [
      { id: 'u1', role: 'user', content: 'Hi', timestamp: '2026-11-05T00:00:00Z' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Done.',
        contentBlocks: [
          {
            type: 'text',
            text: `Done.\n\n<!-- suggested-prompts\n${PROMPT}\nCheck the build status\n-->\n`,
          },
        ],
        timestamp: '2026-11-05T00:00:01Z',
      },
    ],
  } as AgentSession;
}

beforeEach(() => {
  installMockBackend();
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(setWorkspaceEntity(workspace));
  store.dispatch(bulkUpsertSessions([session()]));
  store.dispatch(transcriptHydrationSettled(agentId));
  store.dispatch(setComposerContextItems(workspace.id, agentId, [attachment]));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollTo ??= function scrollTo() {};
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  dispose();
  resetMockBackend();
  vi.unstubAllGlobals();
});

/** Mount first: ChatPanel re-syncs the panel registry on mount. */
async function mount() {
  render(ChatPanel, { props: { workspace, agentId, isActive: true } });
  await tick();
  store.dispatch(setMultiPanelWorkspace(workspace.id));
  store.dispatch(updatePanels([checkedNotePanel]));
  expect(selectCheckedPanels.select(store.state)).toHaveLength(1);
}

function sentPayloads(dispatch: ReturnType<typeof vi.spyOn>) {
  return dispatch.mock.calls
    .map(([action]) => action as { type: string; payload?: unknown })
    .filter((action) => action.type === 'chatState/sendMessage')
    .map((action) => (action.payload as { payload: SendMessagePayload }).payload);
}

function dispatchedTypes(dispatch: ReturnType<typeof vi.spyOn>) {
  return dispatch.mock.calls.map(([action]) => (action as { type: string }).type);
}

describe('suggested prompt selection (ChatPanel)', () => {
  it('sends only the prompt text and leaves the composer intact', async () => {
    await mount();
    const button = await screen.findByRole('button', { name: PROMPT });
    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'my draft' },
    });
    const dispatch = vi.spyOn(store, 'dispatch');

    await fireEvent.click(button);
    await tick();

    const payloads = sentPayloads(dispatch);
    expect(payloads).toHaveLength(1);
    const [payload] = payloads;
    expect(payload.text).toBe(PROMPT);
    expect(payload.contextItems ?? []).toEqual([]);
    expect(payload.workspaceContextStr ?? '').toBe('');
    expect(payload.noteIds ?? []).toEqual([]);
    expect(payload.imageBlocks).toBeUndefined();
    expect(payload.fileBlocks).toBeUndefined();
    expect(payload.messageMetadata).toBeUndefined();

    const types = dispatchedTypes(dispatch);
    expect(types).not.toContain('chatDrafts/clearRequested');
    expect(types).not.toContain('multiPanelContext/clearChecked');
    expect(selectComposerContextItems.select(store.state, workspace.id, agentId)).toEqual([
      attachment,
    ]);
    expect(selectCheckedPanels.select(store.state)).toHaveLength(1);
    expect(screen.getByTestId('mock-rich-input').dataset.value).toBe('my draft');
  });

  it('normal composer send still carries and clears the composer context', async () => {
    await mount();
    await fireEvent.input(await screen.findByTestId('mock-rich-input-editor'), {
      target: { value: 'hello' },
    });
    const dispatch = vi.spyOn(store, 'dispatch');

    await fireEvent.click(screen.getByTestId('mock-input-submit'));
    await tick();

    const [payload] = sentPayloads(dispatch);
    expect(payload.text).toBe('hello');
    expect(payload.contextItems).toEqual([expect.objectContaining({ id: attachment.id })]);
    expect(payload.noteIds).toEqual(['spec']);
    expect(payload.imageBlocks).toHaveLength(1);
    expect(payload.messageMetadata).toEqual({ mentionTokens: ['@src/picked.ts'] });
    const types = dispatchedTypes(dispatch);
    expect(types).toContain('chatDrafts/clearRequested');
    expect(types).toContain('multiPanelContext/clearChecked');
    expect(selectComposerContextItems.select(store.state, workspace.id, agentId)).toEqual([]);
    expect(screen.getByTestId('mock-rich-input').dataset.value).toBe('');
  });
});
