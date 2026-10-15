import { useLayoutEffect, useRef } from 'react';
import { EditableName } from '@/components/ui/editable-name';
import { store } from '@/store';
import { selectAgentSession } from '@/store/agent-session/agent-session-selectors';
import {
  selectAgentRenameAuthority,
  selectAgentRenameContext,
  selectAgentRenameRevision,
  selectAgentRenameOperations,
  selectAgentRenameViewCurrent,
} from '@/store/agent-session/agent-rename-selectors';
import {
  agentRenameViewOpened,
  agentRenameViewReleased,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { renameAgentSessionRequested } from '../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { m } from '$shared/paraglide/messages.js';

function AgentNameEditor({
  workspaceId,
  agentId,
  authority,
  context,
}: {
  workspaceId: string;
  agentId: string;
  authority: string;
  context: string;
}) {
  const session = selectAgentSession(agentId).value;
  const operations = selectAgentRenameOperations(agentId).value;
  const view = useRef<string | null>(null);
  const draft = useRef<{ input: EventTarget; name: string; revision: number } | null>(null);
  useLayoutEffect(() => {
    const id = crypto.randomUUID();
    view.current = id;
    store.dispatch(agentRenameViewOpened(id, workspaceId, agentId, authority, context));
    return () => {
      view.current = null;
      store.dispatch(agentRenameViewReleased(id));
    };
  }, [workspaceId, agentId, authority, context]);
  const blocked = operations.some(
    (operation) =>
      operation.authority === authority &&
      ['queued', 'running', 'unknown'].includes(operation.status),
  );
  return (
    <span
      className="min-w-0"
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLInputElement && draft.current?.input !== event.target) {
          const current = selectAgentSession.select(store.state, agentId);
          draft.current = {
            input: event.target,
            name: current?.name ?? '',
            revision: selectAgentRenameRevision.select(store.state, agentId),
          };
        }
      }}
    >
      <EditableName
        value={session?.name ?? ''}
        title={m.workspace_agentRename_edit_label()}
        placeholder={m.log_friendlyLabels_agentFallback_label()}
        className="max-w-full"
        textClass="type-heading-sm"
        maxWidth={240}
        disabled={blocked || !session}
        onSave={(name) => {
          const viewId = view.current;
          const base = draft.current;
          if (!viewId || !base) return;
          const request = {
            workspaceId,
            agentId,
            name,
            requestId: crypto.randomUUID(),
            authority,
            context,
            viewId,
            expectedRevision: base.revision,
            previousName: base.name,
          };
          if (
            !selectAgentRenameViewCurrent.select(store.state, request) ||
            selectAgentRenameContext.select(store.state, workspaceId, agentId) !== context
          )
            return;
          void store
            .dispatch(renameAgentSessionRequested(workspaceId, agentId, name, request))
            .catch(() => undefined);
        }}
      />
    </span>
  );
}
export function WorkspaceAgentName({
  workspaceId,
  agentId,
}: {
  workspaceId: string;
  agentId: string;
}) {
  const session = selectAgentSession(agentId).value;
  const authority = selectAgentRenameAuthority(workspaceId, agentId).value;
  const context = selectAgentRenameContext(workspaceId, agentId).value;
  return authority && context ? (
    <AgentNameEditor
      key={context}
      workspaceId={workspaceId}
      agentId={agentId}
      authority={authority}
      context={context}
    />
  ) : (
    <>
      {session?.workspaceId === workspaceId
        ? session.name
        : m.log_friendlyLabels_agentFallback_label()}
    </>
  );
}
export function WorkspaceAgentNameStatus({
  workspaceId,
  agentId,
}: {
  workspaceId: string;
  agentId: string;
}) {
  const authority = selectAgentRenameAuthority(workspaceId, agentId).value;
  const operations = selectAgentRenameOperations(agentId).value;
  const operation = operations.filter((entry) => entry.authority === authority).at(-1);
  if (!operation || operation.status === 'confirmed') return null;
  return (
    <p
      data-testid="agent-rename-status"
      role={operation.status === 'failed' || operation.status === 'unknown' ? 'alert' : 'status'}
    >
      {operation.status === 'unknown'
        ? m.workspace_agentRename_unknown_description()
        : operation.status === 'failed'
          ? m.workspace_agentRename_failed_description()
          : m.workspace_agentRename_saving_label()}
    </p>
  );
}
