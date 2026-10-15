import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceGitCommit } from './workspace-git-commit';
import { selectGitCommitState } from '@/store/git/git-commit-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { workspaceMounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { setAgentLockState } from '../../../../../src/store/renderer/slices/agent-lock/agent-lock-slice';
import { setGitStatus } from '../../../../../src/store/renderer/slices/git/git-slice';
import {
  gitWriteRequested,
  gitWriteStarted,
  gitWriteFinished,
} from '../../../../../src/store/renderer/slices/git/git-write-slice';
import { setCommitMessage } from '../../../../../src/store/renderer/slices/changes/changes-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import { GitFileStatus, type Workspace } from '$shared/types';
const ws = WorkspaceId('commit-view');
let dispose: () => void, root: ReturnType<typeof createRoot>, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/commit' } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  store.dispatch(
    setGitStatus(ws, {
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      hasUncommittedChanges: true,
      hasUntrackedFiles: false,
      files: [{ path: 'a.txt', status: GitFileStatus.Modified, staged: true }],
    }),
  );
  store.dispatch(
    setAgentLockState(ws, {}, {}, selectGitCommitState.select(store.state, ws).context!),
  );
  store.dispatch(setCommitMessage(ws, 'Deliberate message'));
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
const render = () => act(async () => root.render(<WorkspaceGitCommit workspaceId={ws} />));
it('retains consecutive input before selector delivery and submits the exact canonical message', async () => {
  store.dispatch(setCommitMessage(ws, ''));
  await render();
  const input = container.querySelector<HTMLTextAreaElement>('textarea')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  const message = 'Reviewed greeting Ω';
  await act(async () => {
    input.focus();
    for (const character of message) {
      setValue.call(input, input.value + character);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(input.value).toBe(message);
    expect(selectGitCommitState.select(store.state, ws).message).toBe(message);
  });
  await vi.waitFor(() =>
    expect(container.querySelector<HTMLButtonElement>('[data-git-commit]')!.disabled).toBe(false),
  );
  await act(async () => container.querySelector<HTMLButtonElement>('[data-git-commit]')!.click());
  const operations = store.state.gitWrite.byWorkspaceId[ws].operations;
  expect(operations.ids).toHaveLength(1);
  expect(operations.map[operations.ids[0]].operation).toMatchObject({
    kind: 'commit',
    params: { message },
  });
});

it('reflects canonical replacement and clearing without replacing an unchanged caret', async () => {
  await render();
  const input = container.querySelector<HTMLTextAreaElement>('textarea')!;
  input.focus();
  input.setSelectionRange(3, 7);
  await act(async () => store.dispatch(setCommitMessage(ws, 'Deliberate message')));
  expect([input.selectionStart, input.selectionEnd]).toEqual([3, 7]);
  await act(async () => store.dispatch(setCommitMessage(ws, 'External replacement')));
  await vi.waitFor(() => expect(input.value).toBe('External replacement'));
  await act(async () => store.dispatch(setCommitMessage(ws, '')));
  await vi.waitFor(() => expect(input.value).toBe(''));
  expect(container.querySelector<HTMLButtonElement>('[data-git-commit]')!.disabled).toBe(true);
});

it('rebinds the DOM field when the same component moves to another workspace', async () => {
  await render();
  const other = WorkspaceId('other-commit-view');
  await act(async () => {
    store.dispatch(
      setWorkspaceEntity({
        id: other,
        myRole: 'owner',
        worktreePath: '/owned/other-commit',
      } as Workspace),
    );
    store.dispatch(workspaceMounted(other));
    store.dispatch(setCommitMessage(other, 'Other workspace message'));
    root.render(<WorkspaceGitCommit workspaceId={other} />);
  });
  await vi.waitFor(() => expect(container.querySelector('textarea')).not.toBeNull());
  const input = container.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(input.value).toBe('Other workspace message');
  await act(async () => store.dispatch(setCommitMessage(ws, 'Old workspace update')));
  expect(input.value).toBe('Other workspace message');
  expect(selectGitCommitState.select(store.state, ws).message).toBe('Old workspace update');
});
function operation() {
  const s = selectGitCommitState.select(store.state, ws);
  return {
    kind: 'commit' as const,
    params: { message: s.message, currentIndex: true as const, userRequested: true },
    reviewedPaths: s.paths,
    authorityKey: s.authorityKey!,
    admissionContext: s.context!,
  };
}
it('disables repeated activation while the canonical transport operation remains running', async () => {
  await render();
  const button = container.querySelector<HTMLButtonElement>('[data-git-commit]')!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  await vi.waitFor(() => expect(button.disabled).toBe(true));
  expect(store.state.gitWrite.byWorkspaceId[ws].operations.ids).toHaveLength(1);
  await act(async () => {
    button.click();
    button.click();
  });
  expect(store.state.gitWrite.byWorkspaceId[ws].operations.ids).toHaveLength(1);
});
it('unknown outcome remains visibly non-retryable after the view retires and remounts', async () => {
  const op = operation();
  store.dispatch(gitWriteRequested(ws, 'unknown', op));
  store.dispatch(gitWriteStarted(ws, 'unknown'));
  store.dispatch(
    gitWriteFinished(ws, 'unknown', { success: false, commitOutcome: { state: 'unknown' } }, op),
  );
  await render();
  expect(container.textContent).toContain('The commit outcome is unknown');
  expect(container.querySelector<HTMLButtonElement>('[data-git-commit]')!.disabled).toBe(true);
  await act(async () => root.render(null));
  await render();
  expect(container.textContent).toContain('This session will not resend');
  expect(container.querySelector<HTMLButtonElement>('[data-git-commit]')!.disabled).toBe(true);
});
it('confirmation requests the returned SHA; history inspection does not replace its identity', async () => {
  const op = operation(),
    hash = 'a'.repeat(40);
  store.dispatch(gitWriteRequested(ws, 'confirmed', op));
  store.dispatch(gitWriteStarted(ws, 'confirmed'));
  store.dispatch(
    gitWriteFinished(
      ws,
      'confirmed',
      { success: true, commitOutcome: { state: 'confirmed', hash, files: ['a.txt'] } },
      op,
    ),
  );
  await render();
  const reads = store.state.git.byWorkspaceId[ws].reads;
  expect(reads.ids).toHaveLength(1);
  expect(reads.map[reads.ids[0]].request).toEqual({ kind: 'commitDetails', commitHash: hash });
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'Inspect latest commit')!
      .click(),
  );
  const latest = store.state.git.byWorkspaceId[ws].reads;
  expect(latest.ids).toHaveLength(1);
  expect(latest.map[latest.ids[0]].request).toEqual({ kind: 'commitDetails', commitHash: 'HEAD' });
  await act(async () => root.render(null));
  expect(store.state.git.byWorkspaceId[ws].reads.ids).toHaveLength(0);
});
