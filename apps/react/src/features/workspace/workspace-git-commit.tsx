import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { store } from '@/store';
import { selectGitCommitState } from '@/store/git/git-commit-selectors';
import { selectGitRead } from '@/store/git/git-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  gitWriteRequested,
  gitWriteConsumerReleased,
} from '../../../../../src/store/renderer/slices/git/git-write-slice';
import { setCommitMessage } from '../../../../../src/store/renderer/slices/changes/changes-slice';
import {
  gitReadRequested,
  releaseGitRead,
  gitReadsInvalidated,
} from '../../../../../src/store/renderer/slices/git/git-slice';
import { m } from '$shared/paraglide/messages.js';

function CommitInspection({ workspaceId, hash }: { workspaceId: string; hash: string }) {
  const consumer = useId();
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const read = selectGitRead(workspaceId, consumer).value;
  useLayoutEffect(() => {
    if (!authority) return;
    let live = true;
    const request = crypto.randomUUID();
    const canRead = () =>
      live && authority === selectAdmittedWorkspaceReadContext.select(store.state, workspaceId);
    store.dispatch(
      gitReadRequested(
        workspaceId,
        consumer,
        request,
        { kind: 'commitDetails', commitHash: hash },
        canRead,
      ),
    );
    return () => {
      live = false;
      store.dispatch(releaseGitRead(workspaceId, consumer, request));
    };
  }, [workspaceId, hash, authority, consumer]);
  const current =
    authority && read?.request.kind === 'commitDetails' && read.request.commitHash === hash
      ? read
      : undefined;
  const details = current?.result?.kind === 'commitDetails' ? current.result.details : undefined;
  return (
    <div className="grid min-w-0 gap-2" data-testid="git-commit-inspection">
      <h3 className="type-heading-sm">
        {hash === 'HEAD'
          ? m.workspace_localCommit_inspect_label()
          : m.workspace_localCommit_confirmed_label()}
      </h3>
      {!current || current.loading ? (
        <p>{m.workspace_noteCodeChanges_loading_label()}</p>
      ) : current.error ? (
        <p role="alert">{current.error}</p>
      ) : details ? (
        <>
          <code className="break-all" data-commit-hash>
            {details.commitHash}
          </code>
          <p className="whitespace-pre-wrap break-words" data-commit-message>
            {details.message}
          </p>
          <ul className="grid gap-1">
            {details.files.map((path) => (
              <li className="break-all" key={path}>
                {path}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>{m.ui_diffViewer_empty_label()}</p>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={!authority || current?.loading}
        onClick={() => store.dispatch(gitReadsInvalidated(workspaceId))}
      >
        {m.workspace_commitsTimeline_refresh_label()}
      </Button>
    </div>
  );
}

export function WorkspaceGitCommit({ workspaceId }: { workspaceId: string }) {
  const consumerId = useId();
  const inputId = useId();
  const state = selectGitCommitState(workspaceId).value;
  const button = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [inspect, setInspect] = useState(false);
  useLayoutEffect(
    () => () => {
      store.dispatch(gitWriteConsumerReleased(workspaceId, consumerId));
    },
    [workspaceId, consumerId],
  );
  useLayoutEffect(() => {
    if (!state.pending && restoreFocus.current) {
      restoreFocus.current = false;
      if (document.activeElement === document.body) button.current?.focus();
    }
  }, [state.pending]);
  const outcome = state.latest?.result?.commitOutcome;
  const unknown = state.commitBlocked;
  const submitting = state.latest?.status === 'queued' || state.latest?.status === 'running';
  const confirmed = outcome?.state === 'confirmed' ? outcome.hash : undefined;
  const submit = () => {
    const current = selectGitCommitState.select(store.state, workspaceId);
    if (
      !current.context ||
      !current.authorityKey ||
      !current.ready ||
      current.locked ||
      current.pending ||
      !current.paths.length ||
      !current.message.trim() ||
      current.commitBlocked
    )
      return;
    restoreFocus.current = document.activeElement === button.current;
    store.dispatch(
      gitWriteRequested(workspaceId, crypto.randomUUID(), {
        kind: 'commit',
        authorityKey: current.authorityKey,
        reviewedPaths: current.paths,
        params: { message: current.message, userRequested: true, currentIndex: true },
        admissionContext: current.context,
        consumerId,
      }),
    );
  };
  if (!state.context) return null;
  return (
    <section className="grid min-w-0 gap-3" data-testid="workspace-git-commit">
      <h3 className="type-heading-sm">{m.workspace_localCommit_title_label()}</h3>
      <p className="type-caption text-muted-foreground">
        {m.workspace_localCommit_index_description()}
      </p>
      <Label htmlFor={inputId}>{m.workspace_mergePanel_commitMessage_label()}</Label>
      <Textarea
        id={inputId}
        value={state.message}
        onChange={(event) =>
          store.dispatch(setCommitMessage(workspaceId, event.currentTarget.value))
        }
        placeholder={m.workspace_commitDrawer_commitMessage_placeholder()}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={button}
          data-git-commit
          disabled={
            !state.ready ||
            state.locked ||
            state.pending ||
            !state.paths.length ||
            !state.message.trim() ||
            unknown
          }
          aria-busy={submitting}
          onClick={submit}
        >
          {submitting
            ? m.workspace_commitDrawer_committing_label()
            : m.workspace_commitDrawer_commit_label()}
        </Button>
        <Button
          variant="outline"
          onClick={() => setInspect((value) => !value)}
          aria-expanded={inspect}
        >
          {m.workspace_localCommit_inspect_label()}
        </Button>
      </div>
      {state.locked && <p>{m.chat_changesPanel_lockedFile_tooltip()}</p>}
      {!state.paths.length && (
        <p className="type-caption text-muted-foreground">
          {m.workspace_commitDrawer_noStaged_tooltip()}
        </p>
      )}
      {unknown ? (
        <p role="alert">{m.workspace_localCommit_unknown_description()}</p>
      ) : (
        state.latest?.status === 'failed' && <p role="alert">{state.latest.result?.error}</p>
      )}
      {(confirmed || inspect) && (
        <CommitInspection
          workspaceId={workspaceId}
          hash={confirmed && !inspect ? confirmed : 'HEAD'}
        />
      )}
    </section>
  );
}
