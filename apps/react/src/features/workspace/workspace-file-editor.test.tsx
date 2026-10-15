import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceFile } from './workspace-file';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { workspaceMounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadFileContentSucceeded,
  loadFileContentFailed,
  fileSaveOperationQueued,
  fileSaveOperationStarted,
  fileSaveOperationSettled,
} from '../../../../../src/store/renderer/slices/files/files-slice';
import { getFileContentEntry } from '../../../../../src/store/renderer/slices/files/files-projections';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { selectGitWriteContext } from '@/store/git/git-write-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
const editor = vi.hoisted(() => ({
  change: undefined as undefined | ((text: string) => void),
  save: undefined as undefined | (() => void),
}));
vi.mock('@/components/editor/code-editor', () => ({
  CodeEditor: ({ onChange, onSave }: { onChange: (text: string) => void; onSave: () => void }) => {
    editor.change = onChange;
    editor.save = onSave;
    return <div data-editor-mock />;
  },
}));
vi.mock('@tanstack/react-router', () => ({
  useBlocker: () => undefined,
  Link: ({ children }: { children: React.ReactNode }) => <a href="/workspaces">{children}</a>,
}));
const ws = WorkspaceId('file-ui'),
  path = 'a.txt';
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
async function render() {
  await act(async () => root.render(<WorkspaceFile workspaceId={ws} path={path} />));
}
it('stores edits canonically without autosaving and keeps the editor available after a definite save error', async () => {
  store.dispatch(
    loadFileContentSucceeded(
      ws,
      path,
      '/owned/repo/a.txt',
      { kind: 'editable-text', content: 'original' },
      false,
    ),
  );
  await render();
  await act(async () => editor.change?.('edited'));
  expect(getFileContentEntry(store.state, ws, path)?.localContent).toBe('edited');
  const button = container.querySelector<HTMLButtonElement>('[data-testid=workspace-file-save]')!;
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(button.disabled).toBe(false);
  });
  await act(async () => {
    store.dispatch(
      fileSaveOperationQueued({
        workspaceId: ws,
        path,
        absolutePath: '/owned/repo/a.txt',
        requestId: 'one',
        authority: selectGitWriteContext.select(store.state, ws)!,
        status: 'queued',
      }),
    );
    store.dispatch(fileSaveOperationSettled('one', 'failed', 'write denied'));
  });
  expect(container.querySelector('[data-editor-mock]')).not.toBeNull();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain('write denied');
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(button.disabled).toBe(false);
  });
});
it('never promotes a failed partial preview retry into an editable file', async () => {
  store.dispatch(
    loadFileContentSucceeded(
      ws,
      path,
      '/owned/repo/a.txt',
      { kind: 'read-only-text', content: 'prefix', bytesRead: 6, totalBytes: 100 },
      true,
    ),
  );
  store.dispatch(loadFileContentFailed(ws, path, '/owned/repo/a.txt', 'read denied'));
  await render();
  expect(container.querySelector('[data-editor-mock]')).toBeNull();
  expect(container.querySelector('[data-testid=workspace-file-save]')).toBeNull();
});
it('blocks save on an unknown result even when the text has been read again', async () => {
  store.dispatch(
    loadFileContentSucceeded(
      ws,
      path,
      '/owned/repo/a.txt',
      { kind: 'editable-text', content: 'original' },
      false,
    ),
  );
  store.dispatch(
    fileSaveOperationQueued({
      workspaceId: ws,
      path,
      absolutePath: '/owned/repo/a.txt',
      requestId: 'one',
      authority: selectGitWriteContext.select(store.state, ws)!,
      status: 'queued',
    }),
  );
  store.dispatch(fileSaveOperationStarted('one'));
  store.dispatch(fileSaveOperationSettled('one', 'uncertain'));
  await render();
  await act(async () => editor.change?.('newer'));
  expect(
    container.querySelector<HTMLButtonElement>('[data-testid=workspace-file-save]')?.disabled,
  ).toBe(true);
  expect(container.textContent).toContain('outcome is unknown');
});
