import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceDiff } from './workspace-diff';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { workspaceMounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/workspaces">{children}</a>,
}));
const ws = WorkspaceId('committed-diff');
let dispose: () => void, root: ReturnType<typeof createRoot>, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/repo' } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  dispose();
  vi.unstubAllGlobals();
});
const reads = () => store.state.git.byWorkspaceId[ws]?.reads;
it('reviews a deleted committed path by exact SHA without staging controls or current file reads', async () => {
  const hash = 'a'.repeat(40);
  await act(async () =>
    root.render(
      <WorkspaceDiff workspaceId={ws} path="deleted.txt" staged={false} commitHash={hash} />,
    ),
  );
  expect(reads()?.ids).toHaveLength(1);
  expect(reads()!.map[reads()!.ids[0]].request).toEqual({
    kind: 'diffs',
    path: 'deleted.txt',
    commitHash: hash,
  });
  expect(container.querySelector('[data-git-write]')).toBeNull();
  expect(container.querySelector('[data-diff-commit]')?.getAttribute('data-diff-commit')).toBe(
    hash,
  );
  await act(async () => root.render(null));
  expect(reads()?.ids.length ?? 0).toBe(0);
});
it('retires exact-hash consumers when a different commit is opened and declines malformed refs', async () => {
  await act(async () =>
    root.render(
      <WorkspaceDiff workspaceId={ws} path="same.txt" staged={true} commitHash={'a'.repeat(40)} />,
    ),
  );
  const first = reads()!.ids[0];
  await act(async () =>
    root.render(
      <WorkspaceDiff workspaceId={ws} path="same.txt" staged={true} commitHash={'b'.repeat(40)} />,
    ),
  );
  expect(reads()?.ids).toHaveLength(1);
  expect(reads()!.map[first]).toBeUndefined();
  expect(reads()!.map[reads()!.ids[0]].request).toEqual({
    kind: 'diffs',
    path: 'same.txt',
    commitHash: 'b'.repeat(40),
  });
  await act(async () =>
    root.render(<WorkspaceDiff workspaceId={ws} path="same.txt" staged={true} commitHash="HEAD" />),
  );
  expect(reads()?.ids.length ?? 0).toBe(0);
});
