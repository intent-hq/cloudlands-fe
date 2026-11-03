import { m } from '$shared/paraglide/messages.js';
import { call, put, race, take, takeLatest, delay, type SagaGenerator } from 'typed-redux-saga';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  dockLinkKey,
  resolveDockDestination,
  type DockShortcutContext,
} from '$shared/dock-shortcuts';
import { store as appStore } from '../../../store';
import { selectDockShortcutWorkspaces } from '../dock-conversation-selectors';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { getLocalStorageJSON, setLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
import {
  dockShortcutChanged,
  dockShortcutChosen,
  openDockConversationRequested,
  dockConversationLoaded,
  dockNativeSpeechSessionChanged,
  dockEvidenceRecordToggleRequested,
  closeDockConversationRequested,
} from '../dock-conversation-slice';
import { getPrincipalActionContext } from '../../principal/principal-context';
import { evidenceOf } from './dock-evidence-saga';

function key(backend: string) {
  return `dock-context-links:${backend}`;
}
function valid(context: DockShortcutContext): boolean {
  return context.backendId === appStore.state.connections.windowBackendId;
}
function* waitForNative(pairId: string): SagaGenerator<void> {
  while (appStore.state.dockConversation.nativeSpeech.pairId !== pairId) {
    yield* take(dockNativeSpeechSessionChanged);
  }
}
function* receive(context?: DockShortcutContext): SagaGenerator<void> {
  if (
    !context ||
    typeof context.id !== 'string' ||
    !['focus', 'record'].includes(context.action) ||
    !valid(context)
  )
    return;
  const stored = yield* call(getLocalStorageJSON<Record<string, string>>, key(context.backendId));
  const links = stored && typeof stored === 'object' ? stored : {};
  const ids = selectDockShortcutWorkspaces.select(appStore.state).map((row) => String(row.id));
  const destination = resolveDockDestination(context, ids, links);
  yield* put(
    dockShortcutChanged({
      context,
      destination: null,
      error: null,
      authority: getPrincipalActionContext(appStore.state),
    }),
  );
  if (destination) yield* put(dockShortcutChosen(destination));
  else if (!appStore.state.dockConversation.workspaceId)
    yield* put(openDockConversationRequested(CHIEF_WORKSPACE_ID));
}
function* choose({
  payload: [workspaceId, scope],
}: ReturnType<typeof dockShortcutChosen>): SagaGenerator<void> {
  const shortcut = appStore.state.dockConversation.shortcut;
  if (
    !shortcut ||
    !valid(shortcut.context) ||
    shortcut.authority !== getPrincipalActionContext(appStore.state)
  )
    return;
  const context = shortcut.context;
  const ids = selectDockShortcutWorkspaces.select(appStore.state).map((row) => String(row.id));
  if (workspaceId !== CHIEF_WORKSPACE_ID && !ids.includes(workspaceId)) return;
  if (scope) {
    const link = dockLinkKey(context, scope);
    if (link) {
      const links =
        (yield* call(getLocalStorageJSON<Record<string, string>>, key(context.backendId))) ?? {};
      yield* call(setLocalStorageJSON, key(context.backendId), { ...links, [link]: workspaceId });
    }
  }
  if (!valid(context) || appStore.state.dockConversation.shortcut?.context.id !== context.id)
    return;
  yield* put(dockShortcutChanged({ ...shortcut, destination: workspaceId, error: null }));
  const current = appStore.state.dockConversation;
  let ready = current.workspaceId === workspaceId && !current.loading && !!current.agentId;
  if (!ready) {
    yield* put(openDockConversationRequested(workspaceId));
    const { loaded } = yield* race({
      loaded: take(dockConversationLoaded),
      closed: take(closeDockConversationRequested),
      timeout: delay(10_000),
    });
    ready = !!loaded;
  }
  const dock = appStore.state.dockConversation;
  if (
    !valid(context) ||
    shortcut.authority !== getPrincipalActionContext(appStore.state) ||
    dock.shortcut?.context.id !== context.id ||
    dock.workspaceId !== workspaceId
  )
    return;
  if (!ready || dock.loading || !dock.agentId || dock.error) {
    yield* put(
      dockShortcutChanged({
        ...shortcut,
        destination: null,
        error: m.dock_shortcut_open_error(),
      }),
    );
    return;
  }
  if (context.action === 'record') {
    const pairId = JSON.stringify([workspaceId, dock.agentId]);
    if (dock.nativeSpeech.pairId !== pairId) {
      yield* race({
        installed: call(waitForNative, pairId),
        closed: take(closeDockConversationRequested),
        timeout: delay(3_000),
      });
    }
    const latest = appStore.state.dockConversation;
    if (
      !valid(context) ||
      latest.shortcut?.context.id !== context.id ||
      latest.workspaceId !== workspaceId ||
      latest.agentId !== dock.agentId ||
      latest.nativeSpeech.pairId !== pairId ||
      latest.authority !== getPrincipalActionContext(appStore.state) ||
      shortcut.authority !== getPrincipalActionContext(appStore.state)
    )
      return;
    // Start once; a repeated global action must never toggle an existing clip off.
    const evidence = evidenceOf(workspaceId, dock.agentId);
    if (!evidence?.clips.some((clip) => clip.status === 'recording'))
      yield* put(dockEvidenceRecordToggleRequested(workspaceId, dock.agentId));
  }
}
export function* dockShortcutSaga(): SagaGenerator<void> {
  yield* takeEveryFromElectronChannel<DockShortcutContext>(WINDOW_CHANNELS.FOCUS_DOCK, receive);
  yield* takeLatest(dockShortcutChosen, choose);
}
