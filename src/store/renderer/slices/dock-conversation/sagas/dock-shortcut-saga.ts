import { readDockSavedDestination } from './dock-context-links-saga';
import {
  hudDeactivated,
  dockPlacementCommandRequested,
  dockCloseRequested,
  dockFocusRequested,
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
import {
  selectDockLinkedContext,
  selectDockShortcutWorkspaces,
} from '../dock-conversation-selectors';
import { selectWorkspaceListLoadedForBackend } from '../../workspace/workspace-selectors';
import { dockSideDefaultWorkspaceId } from '../dock-side-default';
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
  dockSpeechToggleRequested,
  closeDockConversationRequested,
  dockContextFollowed,
  dockLinkedContextChanged,
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
 * not at all. Record stops it, dictate toggles speech there. No focus, selection or
 * destination.
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
  else if (context.action === 'dictate')
    yield* put(dockSpeechToggleRequested(workspaceId, agentId));
}

/** How long a press waits for the feed-admitted context's linked snapshot to publish. */
const RELATED_WAIT_MS = 1500;
/** Every dock shortcut press (any action) supersedes a pending related wait. */
let shortcutRequest = 0;

/**
 * Open related: the dock conversation of the workspace linked to the foreground tab or app the
 * context feed admitted at the press, read from the same admitted linked-context snapshot as
 * the UI. The snapshot may publish after this request (storage/service enrichment): wait,
 * bounded, for exactly that version (wrapped with the current authority); an older version is
 * not yet ours, a different one after ours means the context moved on (stale). Fenced by the
 * latest request, principal and window backend. Needs a present link on a loaded workspace
 * list and no live recording, annotation, dictation or send. A real follow is counted. Never
 * the destination/media flow or the full-app workspace window; drafts are untouched.
 */
function* relatedAction(context: DockShortcutContext): SagaGenerator<void> {
  const request = shortcutRequest;
  const authority = getPrincipalActionContext(appStore.state);
  // A conversation opened meanwhile (by the person or another flow) is never replaced.
  const startedOn = appStore.state.dockConversation.workspaceId;
  if (!authority || !context.contextVersion || !context.identityKey) return;
  const expected = JSON.stringify([authority, context.contextVersion]);
  const deadline = Date.now() + RELATED_WAIT_MS;
  let seen = false;
  while (true) {
    const state = appStore.state;
    if (
      request !== shortcutRequest ||
      state.dockConversation.workspaceId !== startedOn ||
      getPrincipalActionContext(state) !== authority ||
      state.connections.windowBackendId !== context.backendId
    )
      return;
    const snapshot = selectDockLinkedContext.select(state);
    if (snapshot?.contextVersion === expected) {
      seen = true;
      if (snapshot.identityKey !== context.identityKey) return;
      if (
        snapshot.phase === 'ready' &&
        snapshot.linkedWorkspaceId &&
        selectWorkspaceListLoadedForBackend.select(state, context.backendId)
      ) {
        if (dockInputLive() || state.dockConversation.sending) return;
        if (state.dockConversation.workspaceId === snapshot.linkedWorkspaceId) return;
        const target = snapshot.linkedWorkspaceId;
        yield* put(openDockConversationRequested(target));
        yield* put(dockContextFollowed(snapshot.contextVersion));
        // The press asked for composer focus before this conversation existed: ask again once
        // it is open and loaded (a cached reopen may not announce a load), unless something
        // newer took over meanwhile.
        for (let waited = 0; waited < 10_000; waited += 100) {
          const dock = appStore.state.dockConversation;
          if (request !== shortcutRequest || dock.workspaceId !== target || dock.error) break;
          if (!dock.loading && dock.agentId) {
            yield* put(dockFocusRequested());
            break;
          }
          yield* race({ loaded: take(dockConversationLoaded), tick: delay(100) });
        }
        return;
      }
    } else if (seen) return;
    const left = deadline - Date.now();
    if (left <= 0) return;
    yield* race({ changed: take(dockLinkedContextChanged), timeout: delay(left) });
  }
}

/**
 * The open shortcut with the dock on a screen side returns to a chat, ahead of any
 * foreground routing: the chat open in the dock, else the last one opened from it (same
 * machine and authority, still present), else the first workspace the side shows. The
 * side has no home row to choose from; null (no workspace) keeps the existing flow.
 */
function sideDockFallback(context: DockShortcutContext): string | null {
  const state = appStore.state;
  if (context.action !== 'focus' || state.hud.dockPlacement?.shape !== 'edge') return null;
  return dockSideDefaultWorkspaceId(state);
}

function* receive(context?: DockShortcutContext): SagaGenerator<void> {
  if (
    !context ||
    typeof context.id !== 'string' ||
    !['focus', 'capture', 'record', 'dictate', 'related'].includes(context.action) ||
    !valid(context)
  )
    return;
  shortcutRequest++;
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
  // Open related is its own action: never the focus destination or media intent flow.
  if (context.action === 'related') {
    yield* relatedAction(context);
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
        : context.action === 'dictate'
          ? !!dock.nativeSpeech.activeId
          : false;
    if (stop) {
      yield* put(
        dockShortcutChanged({ context, destination: dock.workspaceId, error: null, authority }),
      );
      if (context.action === 'record')
        yield* put(dockEvidenceRecordToggleRequested(dock.workspaceId, dock.agentId));
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
  // On a side, the open shortcut returns to the chat (open, last, else first workspace)
  // before any foreground routing.
  const side = sideDockFallback(context);
  const retained = sameContext ? (selection?.workspaceId ?? null) : null;
  const resolved = resolveDockDestination(context, ids, {});
  const owned =
    context.workspaceId && ids.includes(context.workspaceId) ? context.workspaceId : null;
  const explicit = side ? null : yield* call(readDockSavedDestination, context, ids);
  const destination =
    side ?? explicit ?? owned ?? (context.url && retained ? null : (retained ?? resolved));
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
