/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});
const notifications = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('$lib/components/patterns/notify', async () => ({
  ...(await vi.importActual('$lib/components/ui/toast/toast-countdown')),
  notify: { error: notifications.error },
}));
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../test/mocks/backend-transport.mock';
import AgentCard from '../AgentCard.svelte';
import { store } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  selectAgentBackgroundPending,
  selectAgentSession,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import {
  addAgent,
  setLazyBinLoaded,
  setScopeCounts,
  removeWorkspaceAgentState,
  setAgentBackgroundRequested,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { selectWorkspaceForegroundAgentIds } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
import { classifyAgentScope } from '$shared/utils/agent-scope';
import type { AgentSession, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

const workspace = { id: WorkspaceId('ws-mode-card'), myRole: 'owner' } as Workspace;
const agentId = AgentId('agent-mode-card');
let backend: MockBackendHandle;
let stop: () => void;
function seed(overrides: Partial<AgentSession> = {}) {
  const session = {
    id: agentId,
    workspaceId: workspace.id,
    name: 'Mode fixture',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
    ...overrides,
  } as AgentSession;
  store.dispatch(bulkUpsertSessions([session]));
  store.dispatch(addAgent(workspace.id, session));
}
const current = () => selectAgentSession.select(store.state, agentId)!;
// Match AgentLite: mode lives in metadata, and transcripts are not list/detail fields.
function wireAgent(isBackground: boolean) {
  const agent = current();
  return {
    id: agent.id,
    workspaceId: agent.workspaceId,
    name: agent.name,
    status: agent.status,
    parentAgentId: agent.parentAgentId,
    metadata: { ...agent.metadata, isBackground },
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}
const modeRequests = () => backend.requests.filter((r) => r.method === 'agent.update');
async function openMenu(keyboard = false) {
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  const button = (await screen.findByTestId('agent-list-item')).querySelector('button')!;
  if (keyboard) await fireEvent.keyDown(button, { key: 'F10', shiftKey: true });
  else await fireEvent.contextMenu(button, { clientX: 100, clientY: 100 });
}
beforeEach(() => {
  store.init();
  backend = installMockBackend();
  backend.onRequest('client.hello', () => ({ server: { capabilities: {} } }));
  seed();
  stop = store.runSaga(agentMutationSaga);
});
afterEach(() => {
  cleanup();
  stop();
  store.dispatch(removeSession(agentId));
  store.dispatch(removeWorkspaceAgentState(workspace.id));
  resetMockBackend();
  vi.clearAllMocks();
});

describe('AgentCard mode switching', () => {
  it.each([true, false])(
    'saves background=%s from the menu and updates membership',
    async (isBackground) => {
      seed({
        isBackground: !isBackground,
        metadata: { isBackground: !isBackground, taskNoteId: 'task' },
      });
      backend.onRequest('agent.update', (params) => ({
        success: true,
        agent: wireAgent((params as { changes: { isBackground: boolean } }).changes.isBackground),
      }));
      render(AgentCard, { agentId, workspace, isBackground }); // stale display prop must not drive the action
      await openMenu(!isBackground);
      await fireEvent.click(
        await screen.findByRole('menuitem', {
          name: isBackground ? 'Move to background' : 'Move to foreground',
        }),
      );
      await waitFor(() => expect(current().isBackground).toBe(isBackground));
      expect(modeRequests()).toEqual([
        {
          method: 'agent.update',
          params: {
            agentId,
            workspaceId: workspace.id,
            changes: { isBackground },
          },
        },
      ]);
      expect(current().metadata).toMatchObject({ isBackground, taskNoteId: 'task' });
      expect(
        selectWorkspaceForegroundAgentIds.select(store.state, workspace.id).includes(agentId),
      ).toBe(!isBackground);
      expect(classifyAgentScope(current())).toBe(isBackground ? 'background' : 'topLevel');
      // Mode changes can move the row into another list group, remounting the card.
      cleanup();
      render(AgentCard, { agentId, workspace });
      await openMenu();
      await fireEvent.click(
        await screen.findByRole('menuitem', {
          name: isBackground ? 'Move to foreground' : 'Move to background',
        }),
      );
      await waitFor(() => expect(current().isBackground).toBe(!isBackground));
    },
  );

  it.each([true, false])(
    'saves background=%s while retaining live delegated work',
    async (isBackground) => {
      seed({
        parentAgentId: AgentId('parent'),
        metadata: { isBackground: !isBackground, createdByAgentId: 'parent', taskNoteId: 'task' },
        isStreaming: true,
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'Keep working',
            timestamp: '2026-09-30T00:00:00Z',
          },
        ] as AgentSession['messages'],
      });
      let resolve!: (value: unknown) => void;
      backend.onRequest(
        'agent.update',
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      render(AgentCard, { agentId, workspace });
      await openMenu();
      const label = isBackground ? 'Move to background' : 'Move to foreground';
      await fireEvent.click(await screen.findByRole('menuitem', { name: label }));
      await waitFor(() => expect(modeRequests()).toHaveLength(1));
      // A second mounted card shares the same pending request state.
      cleanup();
      render(AgentCard, { agentId, workspace });
      await openMenu();
      await waitFor(() =>
        expect(screen.getByRole('menuitem', { name: label }).getAttribute('aria-disabled')).toBe(
          'true',
        ),
      );
      await store.dispatch(setAgentBackgroundRequested(workspace.id, agentId, isBackground));
      expect(modeRequests()).toHaveLength(1);
      store.dispatch(
        updateSession(agentId, {
          name: 'Live renamed agent',
          metadata: { ...current().metadata, completionReport: 'New report' },
        }),
      );
      resolve({ success: true, agent: wireAgent(isBackground) });
      await waitFor(() =>
        expect(selectAgentBackgroundPending.select(store.state, agentId)).toBe(false),
      );
      expect(current()).toMatchObject({
        name: 'Live renamed agent',
        isBackground,
        isStreaming: true,
        parentAgentId: 'parent',
        metadata: {
          isBackground,
          createdByAgentId: 'parent',
          taskNoteId: 'task',
          completionReport: 'New report',
        },
      });
      expect(classifyAgentScope(current())).toBe('delegated');
      expect(current().messages).toHaveLength(1);
      expect(current().messages[0].id).toBe('message-1');
    },
  );

  it.each([true, false])(
    'keeps background=%s and unrelated updates after failure, then permits retry',
    async (isBackground) => {
      seed({ isBackground });
      let reject!: (error: Error) => void;
      backend.onRequest(
        'agent.update',
        () =>
          new Promise((_done, fail) => {
            reject = fail;
          }),
      );
      render(AgentCard, { agentId, workspace });
      await openMenu();
      const label = isBackground ? 'Move to foreground' : 'Move to background';
      await fireEvent.click(await screen.findByRole('menuitem', { name: label }));
      await waitFor(() => expect(modeRequests()).toHaveLength(1));
      expect(current().isBackground).toBe(isBackground);
      store.dispatch(updateSession(agentId, { name: 'New name' }));
      reject(new Error('Mode save refused'));
      await waitFor(() => expect(notifications.error).toHaveBeenCalledWith('Mode save refused'));
      await waitFor(() =>
        expect(selectAgentBackgroundPending.select(store.state, agentId)).toBe(false),
      );
      expect(current()).toMatchObject({ isBackground, name: 'New name' });
      backend.onRequest('agent.update', () => ({
        success: true,
        agent: wireAgent(!isBackground),
      }));
      await openMenu();
      await fireEvent.click(await screen.findByRole('menuitem', { name: label }));
      await waitFor(() => expect(current().isBackground).toBe(!isBackground));
    },
  );

  it.each([true, false])(
    'reconciles loaded groups and authoritative counts after background=%s',
    async (isBackground) => {
      seed({ metadata: { isBackground: !isBackground, taskNoteId: 'task' } });
      store.dispatch(setLazyBinLoaded(workspace.id, 'background', true));
      store.dispatch(
        setScopeCounts(workspace.id, {
          topLevel: isBackground ? 1 : 0,
          background: isBackground ? 0 : 1,
          delegated: 0,
        }),
      );
      let persisted = !isBackground;
      backend.onRequest('agent.update', () => {
        persisted = isBackground;
        return { success: true, agent: wireAgent(persisted) };
      });
      backend.onRequest('agent.list', (params) => ({
        agents:
          (params as { scope: string }).scope === (persisted ? 'background' : 'topLevel')
            ? [wireAgent(persisted)]
            : [],
        retiredCount: 0,
        scopeCounts: { topLevel: persisted ? 0 : 1, background: persisted ? 1 : 0, delegated: 0 },
      }));
      const stopReads = store.runSaga(lifecycleReadSaga);
      try {
        await store.dispatch(setAgentBackgroundRequested(workspace.id, agentId, isBackground));
        await waitFor(() =>
          expect(store.state.workspaceAgents.byWorkspaceId[workspace.id].scopeCounts).toEqual({
            topLevel: isBackground ? 0 : 1,
            background: isBackground ? 1 : 0,
            delegated: 0,
          }),
        );
        expect(backend.requests.filter((r) => r.method === 'agent.list')).toEqual([
          { method: 'agent.list', params: { workspaceId: workspace.id, scope: 'topLevel' } },
          { method: 'agent.list', params: { workspaceId: workspace.id, scope: 'background' } },
        ]);
        expect(store.state.workspaceAgents.byWorkspaceId[workspace.id].agentIds).toContain(agentId);
        expect(classifyAgentScope(current())).toBe(isBackground ? 'background' : 'topLevel');
        expect(current().metadata).toMatchObject({ isBackground, taskNoteId: 'task' });
        render(AgentCard, { agentId, workspace });
        await openMenu();
        expect(
          await screen.findByRole('menuitem', {
            name: isBackground ? 'Move to foreground' : 'Move to background',
          }),
        ).toBeTruthy();
      } finally {
        stopReads();
      }
    },
  );

  it.each(['retired', 'read-only', 'missing'])(
    'withholds mode switching for %s sessions',
    async (state) => {
      if (state === 'retired') seed({ retiredAt: '2026-09-30T00:00:00Z' });
      if (state === 'missing') store.dispatch(removeSession(agentId));
      render(AgentCard, { agentId, workspace, readOnly: state === 'read-only' });
      await openMenu();
      expect(
        screen.queryByRole('menuitem', { name: /Move to (foreground|background)/ }),
      ).toBeNull();
      expect(modeRequests()).toEqual([]);
    },
  );
});
