import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, put, take } from 'typed-redux-saga';

import type { GitHubAuthRequiredEvent } from '$features/github-auth/types';
import { isElectron } from '$lib/electron-bridge';
import { navigateToRoute } from '$lib/utils/navigation.client';
import {
  openGitCredentialsModal,
  openGitHubAuthModal,
  type GitCredentialsModalError,
} from '../../global-modals/global-modals-slice';
import { setLastGitError, setLastGitOperation } from '../../git/git-slice';
import type { GitOperationCompletedEvent, GitOperationFailedEvent } from '../../git/git-types';
import { selectActiveWorkspace, selectWorkspaceById } from '../../workspace/workspace-selectors';
import { selectGitCredentialsShownForWorkspace } from '../git-events-selectors';

type GitAuthRequiredEvent = GitCredentialsModalError & { remote?: string };
type GitEvent =
  | { kind: 'completed'; data: GitOperationCompletedEvent }
  | { kind: 'failed'; data: GitOperationFailedEvent }
  | { kind: 'git-auth'; data: GitAuthRequiredEvent }
  | { kind: 'github-auth'; data: GitHubAuthRequiredEvent };

export function createGitEventsChannel(): EventChannel<GitEvent> {
  return eventChannel<GitEvent>((emit) => {
    if (!isElectron() || typeof window === 'undefined' || !window.electronAPI?.on) return () => {};
    const listeners = [
      ['git:op-completed', window.electronAPI.on('git:op-completed', (data) => data && emit({ kind: 'completed', data }))],
      ['git:op-failed', window.electronAPI.on('git:op-failed', (data) => data && emit({ kind: 'failed', data }))],
      ['git:auth-required', window.electronAPI.on('git:auth-required', (data) => data && emit({ kind: 'git-auth', data }))],
      ['github:auth-required', window.electronAPI.on('github:auth-required', (data) => data && emit({ kind: 'github-auth', data }))],
    ] as const;
    return () => {
      for (const [channel, id] of listeners) window.electronAPI.offById(channel, id);
    };
  }, buffers.sliding(1_000));
}

async function toastCompleted(
  data: GitOperationCompletedEvent,
  workspaceName: string,
  showOpen: boolean,
): Promise<void> {
  if ((data.operationType === 'commit' || data.operationType === 'auto-commit') && data.result?.noChanges) return;
  try {
    const { toast } = await import('svelte-sonner');
    const messages = {
      commit: `✅ Changes committed in "${workspaceName}"`,
      push: `✅ Changes pushed in "${workspaceName}"`,
      'create-pr': data.result?.prNumber
        ? `✅ PR #${data.result.prNumber} created in "${workspaceName}"`
        : `✅ PR created in "${workspaceName}"`,
      'auto-commit': `✅ Auto-committed in "${workspaceName}"`,
    } as const;
    const options: { description?: string; duration: number; action?: { label: string; onClick: () => Promise<void> } } = { duration: 5_000 };
    if (data.operationType === 'create-pr' && data.metadata?.prTitle) options.description = data.metadata.prTitle;
    if (showOpen) options.action = { label: 'Open', onClick: () => navigateToRoute(`/workspace/${data.workspaceId}`) };
    toast.success(messages[data.operationType] ?? `✅ Git operation completed in "${workspaceName}"`, options);
  } catch {
    // Toasts are best-effort.
  }
}

async function toastFailed(
  data: GitOperationFailedEvent,
  workspaceName: string,
  activeWorkspaceId?: string,
): Promise<void> {
  const lowerError = data.error.toLowerCase();
  if (data.operationType === 'auto-commit' && (lowerError.includes('hook') || data.error.includes('woken to retry'))) return;
  if (activeWorkspaceId === data.workspaceId && data.operationType !== 'auto-commit') return;
  try {
    const { toast } = await import('svelte-sonner');
    const messages = {
      commit: `❌ Commit failed in "${workspaceName}"`,
      push: `❌ Push failed in "${workspaceName}"`,
      'create-pr': `❌ PR creation failed in "${workspaceName}"`,
      'auto-commit': `❌ Auto-commit failed in "${workspaceName}"`,
    } as const;
    const options: { description: string; duration: number; action?: { label: string; onClick: () => Promise<void> } } = {
      description: data.error.length > 200 ? `${data.error.slice(0, 200)}…` : data.error,
      duration: 10_000,
    };
    if (activeWorkspaceId && activeWorkspaceId !== data.workspaceId) {
      options.action = { label: 'Open', onClick: () => navigateToRoute(`/workspace/${data.workspaceId}`) };
    }
    toast.error(messages[data.operationType] ?? `❌ Git operation failed in "${workspaceName}"`, options);
  } catch {
    // Toasts are best-effort.
  }
}

function* handleGitEvent(event: GitEvent) {
  if (event.kind === 'github-auth') {
    yield* put(openGitHubAuthModal(event.data));
    return;
  }
  if (event.kind === 'git-auth') {
    const shown = event.data.workspaceId
      ? yield* selectGitCredentialsShownForWorkspace.effect(event.data.workspaceId)
      : false;
    if (!shown) {
      const { workspaceId, message, operation, command, cwd, rawError } = event.data;
      yield* put(openGitCredentialsModal({ workspaceId, message, operation, command, cwd, rawError }));
    }
    return;
  }
  const workspace = yield* selectWorkspaceById.effect(event.data.workspaceId);
  const activeWorkspace = yield* selectActiveWorkspace.effect();
  if (event.kind === 'completed') {
    yield* put(setLastGitOperation(event.data));
    yield* call(toastCompleted, event.data, workspace?.title || 'Space', Boolean(activeWorkspace && activeWorkspace.id !== event.data.workspaceId));
  } else {
    yield* put(setLastGitError(event.data));
    yield* call(toastFailed, event.data, workspace?.title || 'Space', activeWorkspace?.id);
  }
}

export function* gitEventsIpcSaga() {
  if (!isElectron()) return;
  const channel = createGitEventsChannel();
  try {
    while (true) {
      const event: GitEvent = yield* take(channel);
      if (event === (END as unknown as GitEvent)) break;
      yield* call(handleGitEvent, event);
    }
  } finally {
    channel.close();
  }
}