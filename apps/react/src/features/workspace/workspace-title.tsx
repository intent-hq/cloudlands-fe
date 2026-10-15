import { useLayoutEffect, useRef } from 'react';
import { EditableName } from '@/components/ui/editable-name';
import { store } from '@/store';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import {
  selectWorkspaceTitleAuthority,
  selectWorkspaceTitleContext,
  selectWorkspaceTitleOperations,
  selectWorkspaceTitleRevision,
  selectWorkspaceTitleViewCurrent,
} from '@/store/workspace/workspace-title-selectors';
import {
  renameWorkspaceTitleRequested,
  workspaceTitleViewOpened,
  workspaceTitleViewReleased,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceId } from '$shared/types/branded-ids';

let nextTitleToken = 0;

function TitleEditor({
  workspaceId,
  authority,
  context,
}: {
  workspaceId: string;
  authority: string;
  context: string;
}) {
  const workspace = selectWorkspaceById(workspaceId).value;
  const operations = selectWorkspaceTitleOperations(workspaceId).value;
  const view = useRef<string | null>(null);
  const draft = useRef<{ input: EventTarget; baseTitle: string; revision: number } | null>(null);
  useLayoutEffect(() => {
    const id = crypto.randomUUID();
    view.current = id;
    store.dispatch(workspaceTitleViewOpened(id, workspaceId, authority));
    return () => {
      view.current = null;
      store.dispatch(workspaceTitleViewReleased(id));
    };
  }, [workspaceId, authority, context]);
  const blocked = operations.some((operation) =>
    ['queued', 'running', 'unknown'].includes(operation.status),
  );
  return (
    <span
      className="min-w-0"
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLInputElement && draft.current?.input !== event.target)
          draft.current = {
            input: event.target,
            baseTitle: workspace?.title ?? '',
            revision: selectWorkspaceTitleRevision.select(store.state, workspaceId),
          };
      }}
    >
      <EditableName
        value={workspace?.title ?? ''}
        placeholder={m.workspace_links_untitled_label()}
        title={m.workspace_title_edit_label()}
        textClass="text-xl font-semibold"
        className="max-w-full"
        maxWidth={240}
        disabled={blocked || !workspace}
        onSave={(title) => {
          const viewId = view.current;
          if (!viewId || !workspace) return;
          const request = {
            workspaceId: WorkspaceId(workspaceId),
            title,
            previousTitle: draft.current?.baseTitle ?? workspace.title,
            expectedRevision:
              draft.current?.revision ??
              selectWorkspaceTitleRevision.select(store.state, workspaceId),
            token: ++nextTitleToken,
            requestId: crypto.randomUUID(),
            authority,
            context,
            viewId,
          };
          if (
            !selectWorkspaceTitleViewCurrent.select(store.state, request) ||
            selectWorkspaceTitleContext.select(store.state, workspaceId) !== context
          )
            return;
          // The shared owner retains operation errors and unknown outcomes, including after unmount.
          void store.dispatch(renameWorkspaceTitleRequested(request)).catch(() => undefined);
        }}
      />
    </span>
  );
}

export function WorkspaceTitle({ workspaceId }: { workspaceId: string }) {
  const workspace = selectWorkspaceById(workspaceId).value;
  const authority = selectWorkspaceTitleAuthority(workspaceId).value;
  const context = selectWorkspaceTitleContext(workspaceId).value;
  return authority && context ? (
    <TitleEditor key={context} workspaceId={workspaceId} authority={authority} context={context} />
  ) : (
    <>{workspace?.title || m.workspace_links_untitled_label()}</>
  );
}

export function WorkspaceTitleStatus({ workspaceId }: { workspaceId: string }) {
  const authority = selectWorkspaceTitleAuthority(workspaceId).value;
  const operations = selectWorkspaceTitleOperations(workspaceId).value;
  const operation = operations.filter((entry) => entry.authority === authority).at(-1);
  if (!operation || operation.status === 'confirmed') return null;
  return (
    <p
      data-testid="workspace-title-status"
      role={operation.status === 'failed' || operation.status === 'unknown' ? 'alert' : 'status'}
    >
      {operation.status === 'unknown'
        ? m.workspace_title_unknown_description()
        : operation.status === 'failed'
          ? m.workspace_title_failed_description()
          : m.workspace_title_saving_label()}
    </p>
  );
}
