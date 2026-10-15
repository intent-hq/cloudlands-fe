import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { store } from '@/store';
import { taskStatusSaga } from '@/store/workspace-tasks/sagas/task-status-saga';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { loadWorkspaceNotesSucceeded } from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { WorkspaceProgress } from './workspace-progress';
import type { Workspace } from '$shared/types';
const f = vi.hoisted(() => ({ backendRequest: vi.fn() }));
vi.mock('@/features/backend/backend-transport', () => ({ backend: f }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/components/workspace/sidebar/flame-graph', () => ({
  FlameGraph: ({ loading }: { loading: boolean }) => (
    <div data-testid="progress-content" aria-busy={loading} />
  ),
}));
it('shows a task-read error, retries only the read, and releases its demand on departure', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({
      id: 'progress-ws',
      myRole: 'owner',
      worktreePath: '/owned/progress',
    } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(loadWorkspaceNotesSucceeded(['progress-ws'], { 'progress-ws': [] }));
  let fail = true;
  f.backendRequest.mockReset().mockImplementation(async (method) => {
    expect(method).toBe('task.list');
    if (fail) throw new Error('Controlled task read unavailable');
    return {
      tasks: [{ id: 'task', title: 'Task', status: 'complete' }],
      stats: { total: 1, completed: 1, inProgress: 0 },
    };
  });
  const stop = store.runSaga(taskStatusSaga);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<WorkspaceProgress workspaceId="progress-ws" />));
    await vi.waitFor(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'Failed to get workspace tasks',
      ),
    );
    expect(host.querySelector('[data-testid="progress-content"]')).toBeNull();
    fail = false;
    const before = f.backendRequest.mock.calls.length;
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid="progress-content"]')).not.toBeNull(),
    );
    expect(f.backendRequest.mock.calls.length).toBe(before + 1);
    expect(store.state.workspaceTasks.byWorkspaceId['progress-ws'].stats.completed).toBe(1);
    await act(async () => root.unmount());
    expect(store.state.workspaceTasks.byWorkspaceId['progress-ws'].demandIds).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    stop();
    dispose();
    vi.unstubAllGlobals();
  }
});
