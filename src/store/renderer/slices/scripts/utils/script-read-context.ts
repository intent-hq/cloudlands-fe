import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { put, type SagaGenerator } from 'typed-redux-saga';
import { selectActiveBackendId } from '../../../utils/backend-storage-namespace';
import { store } from '../../../store';
import { selectWorkspaceActionContext } from '../../workspace/workspace-selectors';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { scriptReadStarted } from '../scripts-slice';
import { replayScriptRead } from '$features/scripts/utils/script-change';
import type { ScriptWithState } from '../scripts-types';
import { selectScriptReadJournal } from '../scripts-selectors';

export function* beginScriptRead(workspaceId: string): SagaGenerator<ScriptReadContext> {
  const context = {
    workspaceId,
    requestId: crypto.randomUUID(),
    dispatch: store.dispatch,
    authority: yield* selectWorkspaceActionContext.effect(workspaceId),
    connection: yield* selectPrincipalConnectionContext.effect(),
    backendId: yield* selectActiveBackendId(),
  };
  yield* put(scriptReadStarted(workspaceId, context.requestId));
  return context;
}

export type ScriptReadContext = {
  workspaceId: string;
  requestId: string;
  dispatch: typeof store.dispatch;
  authority: string | null;
  connection: string | null;
  backendId: string;
};

export function* isScriptReadCurrent(context: ScriptReadContext): SagaGenerator<boolean> {
  const { workspaceId, requestId, authority, connection, dispatch, backendId } = context;
  const pending = yield* selectScriptReadJournal.effect(workspaceId, requestId);
  return (
    !!pending &&
    dispatch === store.dispatch &&
    backendId === (yield* selectActiveBackendId()) &&
    authority === (yield* selectWorkspaceActionContext.effect(workspaceId)) &&
    connection === (yield* selectPrincipalConnectionContext.effect())
  );
}

export function* reconcileScriptRead(
  context: ScriptReadContext,
  entries: ScriptWithState[],
): SagaGenerator<{ scripts: ScriptWithState[]; definitionChanges: Set<string> } | undefined> {
  if (!(yield* isScriptReadCurrent(context))) return;
  const journal = yield* selectScriptReadJournal.effect(context.workspaceId, context.requestId);
  if (!journal) return;
  const changes = getItems(journal);
  return {
    scripts: replayScriptRead(entries, changes),
    definitionChanges: new Set(
      changes.flatMap((change) =>
        change.kind === 'snapshot' || change.kind === 'read'
          ? [change.script.id]
          : change.kind === 'removed'
            ? [change.scriptId]
            : [],
      ),
    ),
  };
}
