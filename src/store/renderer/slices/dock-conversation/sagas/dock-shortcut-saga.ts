import { readDockSavedDestination } from './dock-context-links-saga';
import {
  hudDeactivated,
  dockPlacementCommandRequested,
  dockCloseRequested,
} from '../../hud/hud-slice';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { takeLatestFromSelector } from '@themislib/themis/saga';
import { takeEvery } from 'typed-redux-saga';
import { recordingDockClip } from '$shared/dock-evidence';
import { evidenceOf } from './dock-evidence-saga';
import { dockInputLive } from './dock-live-input';
import { findDockService, isDockServiceCurrent } from './dock-service-routing';
import { m } from '$shared/paraglide/messages.js';
import { call, put, race, take, takeLatest, delay, type SagaGenerator } from 'typed-redux-saga';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { resolveDockDestination, type DockShortcutContext } from '$shared/dock-shortcuts';
import { store as appStore } from '../../../store';
import { selectDockShortcutWorkspaces } from '../dock-conversation-selectors';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import {
  dockShortcutChanged,
  dockShortcutSelectionChanged,
  dockShortcutChosen,
  openDockConversationRequested,
  dockConversationLoaded,
  dockNativeSpeechSessionChanged,
  dockEvidenceRecordToggleRequested,
  dockEvidenceCaptureRequested,
  dockEvidenceAnnotationToggleRequested,
  dockSpeechToggleRequested,
  closeDockConversationRequested,
} from '../dock-conversation-slice';
import { getPrincipalActionContext } from '../../principal/principal-context';

function valid(context: DockShortcutContext): boolean {
  return context.backendId === appStore.state.connections.windowBackendId;
}
function* waitForNative(pairId: string): SagaGenerator<void> {
  while (appStore.state.dockConversation.nativeSpeech.pairId !== pairId) {
    yield* take(dockNativeSpeechSessionChanged);
  }
}
/**
 * A shortcut while a recording keeps the notch out of sight: it acts on the pair that
 * owns the live recording (same admitted authority, current pair, native owner) or
 * not at all. Record stops it, annotate draws in its session (bringing its bar back
 * if needed), dictate toggles speech there. No focus, selection or destination.
 */
function* recordingOwnerAction(context: DockShortcutContext): SagaGenerator<void> {
  const dock = appStore.state.dockConversation;
  const authority = getPrincipalActionContext(appStore.state);
  const { workspaceId, agentId } = dock;
  if (!authority || dock.authority !== authority || !workspaceId || !agentId) return;
  if (dock.nativeSpeech.pairId !== JSON.stringify([workspaceId, agentId])) return;
  if (!recordingDockClip(evidenceOf(workspaceId, agentId))) return;
  if (context.action === 'record')
    yield* put(dockEvidenceRecordToggleRequested(workspaceId, agentId));
  else if (context.action === 'annotate')
    yield* put(dockEvidenceAnnotationToggleRequested(workspaceId, agentId));
  else if (context.action === 'dictate')
    yield* put(dockSpeechToggleRequested(workspaceId, agentId));
}

function* receive(context?: DockShortcutContext): SagaGenerator<void> {
  if (
    !context ||
    typeof context.id !== 'string' ||
    !['focus', 'capture', 'record', 'annotate', 'dictate'].includes(context.action) ||
    !valid(context)
  )
    return;
  // The open shortcut again, while the dock has the keyboard: close as Escape would,
  // unless a recording, an annotate session or dictation is live (then nothing changes).
  if (context.toggleClose === true) {
    if (context.action !== 'focus') return;
    if (!dockInputLive()) yield* put(dockCloseRequested());
    return;
  }
  // While a recording is live: only that recording's own pair, never routed.
  if (context.recordingOwnerOnly === true) {
    yield* recordingOwnerAction(context);
    return;
  }
  // Stop the already-active native owner before consulting a new foreground destination.
  // Retained evidence alone is insufficient: the same pair and admitted authority must still own native.
  const dock = appStore.state.dockConversation;
  const authority = getPrincipalActionContext(appStore.state);
  if (
    authority &&
    dock.authority === authority &&
    dock.workspaceId &&
    dock.agentId &&
    dock.nativeSpeech.pairId === JSON.stringify([dock.workspaceId, dock.agentId])
  ) {
    const evidence = evidenceOf(dock.workspaceId, dock.agentId);
    const stop =
      context.action === 'record'
        ? !!recordingDockClip(evidence)
        : context.action === 'annotate'
          ? !!evidence?.annotation && evidence.annotation.mode !== 'dictation'
          : context.action === 'dictate'
            ? !!dock.nativeSpeech.activeId
            : false;
    if (stop) {
      yield* put(
        dockShortcutChanged({ context, destination: dock.workspaceId, error: null, authority }),
      );
      if (context.action === 'record')
        yield* put(dockEvidenceRecordToggleRequested(dock.workspaceId, dock.agentId));
      else if (context.action === 'annotate')
        yield* put(dockEvidenceAnnotationToggleRequested(dock.workspaceId, dock.agentId));
      else yield* put(dockSpeechToggleRequested(dock.workspaceId, dock.agentId));
      return;
    }
  }
  const ids = selectDockShortcutWorkspaces.select(appStore.state).map((row) => String(row.id));
  const selection = appStore.state.dockConversation.shortcutSelection;
  const selectionValid =
    !!selection &&
    selection.backendId === context.backendId &&
    selection.authority === authority &&
    (selection.workspaceId === CHIEF_WORKSPACE_ID || ids.includes(selection.workspaceId));
  if (selection && !selectionValid) yield* put(dockShortcutSelectionChanged(null));
  const sameContext =
    selectionValid &&
    selection &&
    !(context.appId && selection.appId && context.appId !== selection.appId) &&
    !(context.url && selection.url && context.url !== selection.url);
  const retained = sameContext ? (selection?.workspaceId ?? null) : null;
  const resolved = resolveDockDestination(context, ids, {});
  const owned =
    context.workspaceId && ids.includes(context.workspaceId) ? context.workspaceId : null;
  const explicit = yield* call(readDockSavedDestination, context, ids);
  const destination =
    explicit ?? owned ?? (context.url && retained ? null : (retained ?? resolved));
  yield* put(
    dockShortcutChanged({
      context,
      destination: null,
      error: null,
      authority,
      resolving: !!retained && !!context.url && !destination,
    }),
  );
  if (destination) {
    yield* put(dockShortcutChosen(destination));
    return;
  }
  if (!context.url) return;
  const result = yield* race({
    service: call(findDockService, context, ids),
    manual: take(dockShortcutChosen),
    changed: take(dockShortcutChanged),
    timeout: delay(2_000),
  });
  const current = appStore.state.dockConversation.shortcut;
  if (
    !current ||
    current.destination !== null ||
    current.context.id !== context.id ||
    !valid(context) ||
    current.authority !== getPrincipalActionContext(appStore.state)
  )
    return;
  if (result.service) {
    yield* put(dockShortcutChanged({ ...current, service: result.service, resolving: false }));
    yield* put(dockShortcutChosen(result.service.workspaceId));
  } else if (!result.manual && !result.changed && (retained || resolved)) {
    yield* put(dockShortcutChosen((retained || resolved)!));
  } else if (!result.manual && !result.changed)
    yield* put(dockShortcutChanged({ ...current, resolving: false }));
}

function* choose({
  payload: [workspaceId],
}: ReturnType<typeof dockShortcutChosen>): SagaGenerator<void> {
  const shortcut = appStore.state.dockConversation.shortcut;
  if (
    !shortcut ||
    shortcut.destination !== null ||
    !shortcut.authority ||
    !valid(shortcut.context) ||
    shortcut.authority !== getPrincipalActionContext(appStore.state)
  )
    return;
  const ids = selectDockShortcutWorkspaces.select(appStore.state).map((row) => String(row.id));
  if (workspaceId !== CHIEF_WORKSPACE_ID && !ids.includes(workspaceId)) return;
  const context = shortcut.context;
  yield* put(
    dockShortcutChanged({ ...shortcut, destination: workspaceId, error: null, resolving: false }),
  );
  const service = shortcut.service?.workspaceId === workspaceId ? shortcut.service : undefined;
  if (service && !(yield* call(isDockServiceCurrent, service))) {
    if (appStore.state.dockConversation.shortcut?.context.id === context.id)
      yield* put(dockShortcutChanged({ ...shortcut, service: undefined, destination: null }));
    return;
  }
  if (!valid(context) || appStore.state.dockConversation.shortcut?.context.id !== context.id)
    return;
  yield* put(
    dockShortcutChanged({ ...shortcut, destination: workspaceId, error: null, resolving: false }),
  );
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
  if (context.action !== 'focus') {
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
    if (service && !(yield* call(isDockServiceCurrent, service))) {
      if (appStore.state.dockConversation.shortcut?.context.id === context.id)
        yield* put(dockShortcutChanged({ ...shortcut, service: undefined, destination: null }));
      return;
    }
    const target = appStore.state.dockConversation;
    if (
      !valid(context) ||
      target.shortcut?.context.id !== context.id ||
      target.workspaceId !== workspaceId ||
      target.agentId !== dock.agentId ||
      shortcut.authority !== getPrincipalActionContext(appStore.state)
    )
      return;
    if (context.action === 'capture')
      yield* put(dockEvidenceCaptureRequested(workspaceId, dock.agentId));
    else if (context.action === 'record')
      yield* put(dockEvidenceRecordToggleRequested(workspaceId, dock.agentId));
    else if (context.action === 'annotate')
      yield* put(dockEvidenceAnnotationToggleRequested(workspaceId, dock.agentId));
    else yield* put(dockSpeechToggleRequested(workspaceId, dock.agentId));
  }
}
export function* dockShortcutSaga(): SagaGenerator<void> {
  yield* takeEveryFromElectronChannel<DockShortcutContext>(WINDOW_CHANNELS.FOCUS_DOCK, receive);
  yield* takeLatest(dockShortcutChosen, choose);
  yield* takeEvery([closeDockConversationRequested, hudDeactivated], function* () {
    yield* put(dockShortcutChanged(null));
  });
  yield* takeEvery(dockPlacementCommandRequested, function* ({ payload: [command] }) {
    if (command.action === 'dismiss' || command.action === 'release')
      yield* put(dockShortcutChanged(null));
  });
  yield* takeLatestFromSelector(selectPrincipalActionContext, function* () {
    const shortcut = appStore.state.dockConversation.shortcut;
    const authority = getPrincipalActionContext(appStore.state);
    if (shortcut && shortcut.authority !== authority) yield* put(dockShortcutChanged(null));
    const selection = appStore.state.dockConversation.shortcutSelection;
    if (selection && selection.authority !== authority)
      yield* put(dockShortcutSelectionChanged(null));
  });
}
