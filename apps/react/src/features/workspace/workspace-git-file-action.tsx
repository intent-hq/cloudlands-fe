import { useId, useLayoutEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { store } from '@/store';
import { selectGitWriteFileState } from '@/store/git/git-write-selectors';
import {
  gitWriteConsumerReleased,
  gitWriteRequested,
} from '../../../../../src/store/renderer/slices/git/git-write-slice';
import { m } from '$shared/paraglide/messages.js';

export function WorkspaceGitFileAction({
  workspaceId,
  path,
  staged,
  consumerId: sharedConsumer,
}: {
  workspaceId: string;
  path: string;
  staged: boolean;
  consumerId?: string;
}) {
  const ownConsumer = useId();
  const consumerId = sharedConsumer ?? ownConsumer;
  const button = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const state = selectGitWriteFileState(workspaceId, path, staged).value;
  useLayoutEffect(
    () => () => {
      if (!sharedConsumer) store.dispatch(gitWriteConsumerReleased(workspaceId, consumerId));
    },
    [workspaceId, consumerId, sharedConsumer],
  );
  useLayoutEffect(() => {
    if (!state.pending && restoreFocus.current) {
      restoreFocus.current = false;
      if (document.activeElement === document.body) button.current?.focus();
    }
  }, [state.pending]);
  if (!state.context) return null;
  return (
    <div className="grid min-w-0 gap-1">
      <Button
        ref={button}
        variant="outline"
        size="sm"
        data-git-write={staged ? 'unstage' : 'stage'}
        data-git-write-path={path}
        disabled={!state.present || !state.ready || state.locked || state.pending}
        title={state.locked ? m.chat_changesPanel_lockedFile_tooltip() : undefined}
        aria-busy={state.pending}
        onClick={() => {
          const current = selectGitWriteFileState.select(store.state, workspaceId, path, staged);
          if (
            !current.present ||
            !current.context ||
            !current.ready ||
            current.locked ||
            current.pending
          )
            return;
          restoreFocus.current = document.activeElement === button.current;
          store.dispatch(
            gitWriteRequested(workspaceId, crypto.randomUUID(), {
              kind: staged ? 'unstage' : 'stage',
              paths: [path],
              consumerId,
              admissionContext: current.context,
            }),
          );
        }}
      >
        {staged ? m.ui_trackedDiff_unstage_label() : m.ui_trackedDiff_stage_label()}
      </Button>
      {state.locked && (
        <span className="type-caption text-muted-foreground">
          {m.chat_bulkProposalItems_locked_label()}
        </span>
      )}
      {!state.ready && (
        <span className="type-caption text-muted-foreground">
          {m.workspace_noteCodeChanges_loading_label()}
        </span>
      )}
      {!sharedConsumer && state.error && (
        <p role="alert" className="type-caption break-words">
          {state.error}
        </p>
      )}
    </div>
  );
}
