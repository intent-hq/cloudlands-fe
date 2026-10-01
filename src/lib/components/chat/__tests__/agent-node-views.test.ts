/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession } from '$shared/types';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import AgentCard from '../AgentCard.svelte';
import ChatChangesPanelHarness from '../ChatChangesPanelHarness.svelte';
import ToolCall from '../ToolCall.svelte';
import { invoke } from '$lib/electron-bridge';
import { canOpenAgentPath } from '../agent-path-actions';
import { appClient } from '$lib/client';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';

const id = 'agent-node-view';
const makeAgent = (extra: Partial<AgentSession> = {}): AgentSession => ({
  id: AgentId(id),
  backendSessionId: null,
  workspaceId: WorkspaceId('preview-chat-changes'),
  name: 'Remote builder',
  status: AgentStatus.Halted,
  messages: [],
  createdAt: '2026-09-28T08:00:00Z',
  updatedAt: '2026-09-28T08:00:00Z',
  placement: { target: 'remote', checkout: 'isolated' },
  nodeState: 'offline',
  checkpoint: {
    id: 'checkpoint-view',
    assignmentEpoch: '1',
    captureRevision: '3',
    capturedAt: '2026-09-28T08:45:00Z',
    committedAt: '2026-09-28T08:45:01Z',
  },
  ...extra,
});
const changes = [
  {
    filePath: '/node-only/src/file.ts',
    action: 'modify' as const,
    additions: 1,
    deletions: 1,
    toolName: 'edit_file',
    toolCallId: 'edit-1',
    oldContent: 'old',
    newContent: 'new',
  },
];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  appStore.init();
  vi.mocked(invoke).mockClear();
});
afterEach(() => {
  cleanup();
  appStore.dispatch(removeSession(id));
  appStore.dispatch(setLabsRemoteAgentsEnabled(false));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('node agents in existing views', () => {
  it('restores a failed remote rename while keeping halted status and path restrictions', async () => {
    const response = Promise.withResolvers<{ success: false; error: string }>();
    const rename = vi.spyOn(appClient.agents, 'rename').mockReturnValue(response.promise);
    appStore.dispatch(bulkUpsertSessions([makeAgent()]));
    const stop = appStore.runSaga(agentMutationSaga);
    try {
      const view = render(AgentCard, { agentId: id, panelRow: true, hidePreview: true });
      await fireEvent.contextMenu(view.container.querySelector('[data-agent-panel-row]')!);
      await fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
      const input = await screen.findByRole('textbox', { name: 'Rename' });
      await fireEvent.input(input, { target: { value: 'Temporary identity' } });
      await fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() =>
        expect(screen.getByTestId('agent-card-name').textContent).toBe('Temporary identity'),
      );
      expect(rename).toHaveBeenCalledExactlyOnceWith(
        id,
        'Temporary identity',
        'preview-chat-changes',
      );
      response.resolve({ success: false, error: 'rename refused' });
      await waitFor(() =>
        expect(screen.getByTestId('agent-card-name').textContent).toBe('Remote builder'),
      );
      expect(screen.getByTestId('agent-card-status').textContent).toBe('Halted');
      expect(canOpenAgentPath(appStore.state, id)).toBe(false);
      expect(appStore.state.agentSessions.byAgentId[id]?.checkpoint?.id).toBe('checkpoint-view');
    } finally {
      stop();
    }
  });

  it('reacts to provisioning, halt and resume while preserving legacy labels', async () => {
    appStore.dispatch(
      bulkUpsertSessions([
        makeAgent({ status: AgentStatus.Pending, effectiveIsolation: 'pending' }),
      ]),
    );
    const view = render(AgentCard, { agentId: id, statusLabel: 'Existing label' });
    expect(screen.getByTestId('agent-card-status').textContent).toBe('Provisioning');
    appStore.dispatch(bulkUpsertSessions([makeAgent()]));
    await waitFor(() => expect(screen.getByTestId('agent-card-status').textContent).toBe('Halted'));
    appStore.dispatch(bulkUpsertSessions([makeAgent({ status: AgentStatus.Resuming })]));
    await waitFor(() =>
      expect(screen.getByTestId('agent-card-status').textContent).toBe('Resuming'),
    );
    appStore.dispatch(
      bulkUpsertSessions([
        makeAgent({
          status: AgentStatus.RuntimeIdle,
          placement: undefined,
          nodeState: undefined,
          checkpoint: undefined,
        }),
      ]),
    );
    await view.rerender({ agentId: id, statusLabel: 'Existing label' });
    await waitFor(() =>
      expect(screen.getByTestId('agent-card-status').textContent).toBe('Existing label'),
    );
  });
  it.each([false, true])(
    'preserves checkpoint inspection and path guards with remote Labs=%s',
    async (enabled) => {
      appStore.dispatch(setLabsRemoteAgentsEnabled(enabled));
      appStore.dispatch(bulkUpsertSessions([makeAgent()]));
      const dispatch = vi.spyOn(appStore, 'dispatch');
      render(ChatChangesPanelHarness, {
        changes,
        agentId: id,
        isAggregate: true,
        showStagingControls: true,
      });
      const checkpointStatus = screen.getByText(/Last successful checkpoint:/);
      expect(checkpointStatus.textContent).toContain('2026-09-28T08:45:00Z');
      expect(checkpointStatus.textContent).toContain('not checkpoint contents');
      const open = await screen.findByRole('button', { name: 'Open file' });
      expect(open.hasAttribute('disabled')).toBe(true);
      await fireEvent.click(open);
      expect(
        dispatch.mock.calls.some(
          ([action]) => action.type === 'workspaceNavigation/openWorkspaceFile',
        ),
      ).toBe(false);
      expect(
        vi
          .mocked(invoke)
          .mock.calls.some(([channel]) => channel === 'git:diff' || channel === 'file:read'),
      ).toBe(false);
    },
  );
  it('keeps an existing remote agent visible and responsive after Labs is disabled', async () => {
    appStore.dispatch(setLabsRemoteAgentsEnabled(true));
    appStore.dispatch(bulkUpsertSessions([makeAgent()]));
    render(AgentCard, { agentId: id });
    expect(screen.getByTestId('agent-card-status').textContent).toBe('Halted');
    vi.mocked(invoke).mockClear();
    appStore.dispatch(setLabsRemoteAgentsEnabled(false));
    appStore.dispatch(bulkUpsertSessions([makeAgent({ status: AgentStatus.Resuming })]));
    await waitFor(() =>
      expect(screen.getByTestId('agent-card-status').textContent).toBe('Resuming'),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not invent a checkpoint time when no checkpoint succeeded', () => {
    appStore.dispatch(bulkUpsertSessions([makeAgent({ checkpoint: undefined })]));
    render(ChatChangesPanelHarness, { changes, agentId: id });
    const checkpointStatus = screen.getByText(/No successful checkpoint available/);
    expect(checkpointStatus.textContent).not.toContain('2026-09');
  });
  it('leaves ordinary local diff actions available', async () => {
    appStore.dispatch(
      bulkUpsertSessions([
        makeAgent({ placement: undefined, nodeState: undefined, checkpoint: undefined }),
      ]),
    );
    render(ChatChangesPanelHarness, { changes, agentId: id });
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      (await screen.findByRole('button', { name: 'Open file' })).hasAttribute('disabled'),
    ).toBe(false);
  });
  it('blocks a tool file link after a remote placement update', async () => {
    appStore.dispatch(
      bulkUpsertSessions([makeAgent({ placement: undefined, nodePath: undefined })]),
    );
    const dispatch = vi.spyOn(appStore, 'dispatch');
    render(ToolCall, {
      agentId: id,
      workspaceId: 'preview-chat-changes',
      toolUse: {
        type: 'tool_use',
        id: 'read-1',
        name: 'read_file',
        input: { path: '/node-only/src/file.ts' },
      },
      toolState: 'completed',
      result: { content: 'text' },
    });
    const link = screen.getByTestId('tool-call-file-link');
    appStore.dispatch(bulkUpsertSessions([makeAgent()]));
    dispatch.mockClear();
    await fireEvent.click(link);
    expect(
      dispatch.mock.calls.some(
        ([action]) => action.type === 'workspaceNavigation/openWorkspaceFile',
      ),
    ).toBe(false);
    appStore.dispatch(
      bulkUpsertSessions([makeAgent({ placement: undefined, nodePath: undefined })]),
    );
    dispatch.mockClear();
    await fireEvent.click(link);
    expect(
      dispatch.mock.calls.some(
        ([action]) => action.type === 'workspaceNavigation/openWorkspaceFile',
      ),
    ).toBe(true);
  });
  it('checks current path provenance and rejects unknown, remote and local isolated agents', () => {
    expect(canOpenAgentPath(appStore.state, id)).toBe(false);
    appStore.dispatch(
      bulkUpsertSessions([makeAgent({ placement: { target: 'local', checkout: 'shared' } })]),
    );
    expect(canOpenAgentPath(appStore.state, id)).toBe(true);
    appStore.dispatch(bulkUpsertSessions([makeAgent()]));
    expect(canOpenAgentPath(appStore.state, id)).toBe(false);
    appStore.dispatch(
      bulkUpsertSessions([makeAgent({ placement: { target: 'local', checkout: 'isolated' } })]),
    );
    expect(canOpenAgentPath(appStore.state, id)).toBe(false);
  });
});
