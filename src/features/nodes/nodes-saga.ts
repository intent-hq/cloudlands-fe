/**
 * Add a machine or node from an `intent://pair` link (renderer).
 *
 * Main tests the link and keeps its credential (`connections:pair-link-*`);
 * this saga only handles the pending id, a masked copy for display, and the
 * decisions: a full daemon is saved at once; a node is saved only when the
 * current backend can run agents on other machines (else refused, nothing
 * saved), then the in-app prompt asks whether to make it available. Every
 * route asks: the paste item, the Add machine dialog and links opened from
 * outside the app.
 */

import { call, delay, put, race, take, takeLatest, type SagaGenerator } from 'typed-redux-saga';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionRecord } from '$shared/types/connections';
import type {
  PairLinkCommitResult,
  PairLinkInspectResult,
  PairLinkInspected,
} from '$shared/types/pair-link';
import { isPairingUri, maskPairingUri } from '$shared/utils/pairing-uri';
import { confirm } from '$lib/components/patterns/confirm';
import { notify } from '$lib/components/patterns/notify';
import { store } from '$store/renderer/store';
import { selectLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import {
  remoteMachineExposeRequested,
  remoteMachinesLoaded,
  remoteMachinesRefreshRequested,
} from '$features/remote-machines/remote-machines-slice';
import {
  selectCurrentBackendLabel,
  selectRemoteMachines,
} from '$features/remote-machines/remote-machines-selectors';
import {
  canOfferExpose,
  machineForConnection,
} from '$features/remote-machines/remote-machines-utils';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { formatConnectionLabel } from '$lib/utils/connection-label';
import { forgetConnectionRequested } from '$store/renderer/slices/connections/connections-slice';
import {
  nodeConnectionOpened,
  nodeLinkReceived,
  pasteClosed,
  pasteCompleted,
  pasteFailed,
  pasteFieldOpened,
  pasteLinkRequested,
  pasteLinkRetried,
  pasteLinkSubmitted,
  pasteTestingStarted,
  rowHighlighted,
} from './nodes-slice';
import type { NodeAddError } from './nodes-types';

const HIGHLIGHT_MS = 2_500;

/** The last link submitted in the paste row, for Try again. Never put in state. */
let lastPasted: string | null = null;
const SNAPSHOT_WAIT_MS = 15_000;

function bridge() {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.invoke) throw new Error('pair link bridge unavailable'); // i18n-ignore (developer diagnostic)
  return api;
}

// Each call names its channel so the IPC reachability scan can see the main handler's caller.
const invokeInspect = async (uri: string): Promise<unknown> =>
  bridge().invoke(IPC_CHANNELS.CONNECTIONS.PAIR_LINK_INSPECT, { uri });
const invokeCommit = async (pendingId: string): Promise<unknown> =>
  bridge().invoke(IPC_CHANNELS.CONNECTIONS.PAIR_LINK_COMMIT, { pendingId });
const invokeDiscard = async (pendingId: string): Promise<unknown> =>
  bridge().invoke(IPC_CHANNELS.CONNECTIONS.PAIR_LINK_DISCARD, { pendingId });

async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

function inspectReply(reply: unknown): PairLinkInspectResult {
  const value = (reply ?? {}) as Record<string, unknown>;
  if (
    value.ok === true &&
    typeof value.pendingId === 'string' &&
    (value.kind === 'machine' || value.kind === 'node') &&
    typeof value.label === 'string'
  )
    return {
      ok: true,
      pendingId: value.pendingId,
      kind: value.kind,
      label: value.label,
      existingId: typeof value.existingId === 'string' ? value.existingId : null,
    };
  if (value.ok === false && typeof value.code === 'string') return reply as PairLinkInspectResult;
  return { ok: false, code: 'failed' };
}

function commitReply(reply: unknown): PairLinkCommitResult {
  const value = (reply ?? {}) as Record<string, unknown>;
  if (value.ok === true && value.connection && typeof value.connection === 'object')
    return reply as PairLinkCommitResult;
  return { ok: false, code: value.code === 'expired' ? 'expired' : 'failed' };
}

/** Labs Remote agents is on and the current backend advertises `remoteMachines: 1`. */
function* nodeSupport(): SagaGenerator<'ok' | 'labs-off' | 'backend-unsupported'> {
  if (!selectLabsRemoteAgentsEnabled.select(store.state)) return 'labs-off';
  if (store.state.remoteMachines.supported) return 'ok';
  yield* put(remoteMachinesRefreshRequested());
  yield* race({ loaded: take(remoteMachinesLoaded), timeout: delay(SNAPSHOT_WAIT_MS) });
  return store.state.remoteMachines.supported ? 'ok' : 'backend-unsupported';
}

function* highlight(connectionId: string): SagaGenerator<void> {
  yield* put(rowHighlighted(connectionId));
}

function* clearHighlight(action: ReturnType<typeof rowHighlighted>): SagaGenerator<void> {
  if (!action.payload[0]) return;
  yield* delay(HIGHLIGHT_MS);
  yield* put(rowHighlighted(null));
}

/** Ask before making a node available; skipped when it already is. */
function* promptForNode(connection: ConnectionRecord, label: string): SagaGenerator<void> {
  const machines = selectRemoteMachines.select(store.state);
  const exposed = machineForConnection(machines, connection, null);
  if (!canOfferExpose(exposed)) return;
  const backend = selectCurrentBackendLabel.select(store.state);
  const accepted = yield* call(confirm, {
    title: m.nodes_prompt_title({ node: label, backend }),
    description: m.nodes_prompt_description({ node: label, backend }),
    confirmLabel: m.nodes_prompt_confirm_label(),
    cancelLabel: m.nodes_prompt_cancel_label(),
  });
  if (accepted) yield* put(remoteMachineExposeRequested(connection.id, undefined, true));
}

/**
 * Save an inspected link, or refuse a node the current backend can't use.
 * Returns the error to show, or null once saved (and prompted).
 */
function* addInspected(
  inspected: PairLinkInspected,
  fromPaste = false,
): SagaGenerator<NodeAddError | null> {
  if (inspected.kind === 'node') {
    const support = yield* call(nodeSupport);
    if (support !== 'ok') {
      yield* call(invokeDiscard, inspected.pendingId);
      return { code: support, node: inspected.label };
    }
  }
  let committed: PairLinkCommitResult;
  try {
    committed = commitReply(yield* call(invokeCommit, inspected.pendingId));
  } catch {
    committed = { ok: false, code: 'failed' };
  }
  if (!committed.ok) return { code: committed.code };
  yield* call(highlight, committed.connection.id);
  if (fromPaste) {
    lastPasted = null;
    yield* put(pasteCompleted());
  }
  if (inspected.kind === 'node') yield* call(promptForNode, committed.connection, inspected.label);
  return null;
}

function* testPasted(text: string): SagaGenerator<void> {
  lastPasted = text;
  if (!isPairingUri(text)) {
    yield* put(pasteFieldOpened());
    yield* put(pasteFailed({ code: 'not-a-link' }));
    return;
  }
  yield* put(pasteTestingStarted(maskPairingUri(text)));
  let inspected: PairLinkInspectResult;
  try {
    inspected = inspectReply(yield* call(invokeInspect, text));
  } catch {
    inspected = { ok: false, code: 'failed' };
  }
  if (!inspected.ok) {
    yield* put(
      pasteFailed({
        code: inspected.code,
        ...(inspected.routes ? { routes: inspected.routes } : {}),
        ...(inspected.message ? { message: inspected.message } : {}),
      }),
    );
    return;
  }
  const error = yield* call(addInspected, inspected, true);
  if (error) yield* put(pasteFailed(error));
}

/** Run one paste attempt; Cancel stops it (a credential tested meanwhile expires in main). */
function* runPaste(text: string): SagaGenerator<void> {
  const result = yield* race({ done: call(testPasted, text), cancelled: take(pasteClosed) });
  if (result.cancelled) lastPasted = null;
}

function* requestPaste(): SagaGenerator<void> {
  const clipboard = (yield* call(readClipboard)).trim();
  if (isPairingUri(clipboard)) yield* call(runPaste, clipboard);
  else yield* put(pasteFieldOpened());
}

function* submitPaste(action: ReturnType<typeof pasteLinkSubmitted>): SagaGenerator<void> {
  yield* call(runPaste, action.payload[0].trim());
}

function* retryPaste(): SagaGenerator<void> {
  if (lastPasted) yield* call(runPaste, lastPasted);
}

function nodeLinkErrorMessage(error: NodeAddError): string {
  const backend = selectCurrentBackendLabel.select(store.state);
  const node = error.node ?? '';
  switch (error.code) {
    case 'labs-off':
      return m.nodes_error_labsOff({ node });
    case 'backend-unsupported':
      return m.nodes_error_backendUnsupported({ node, backend });
    case 'expired':
      return m.nodes_error_expired();
    default:
      return m.nodes_error_failed();
  }
}

/** A node link opened from a browser or a QR scan: Settings → Machines, then the same prompt. */
function* receiveNodeLink(action: ReturnType<typeof nodeLinkReceived>): SagaGenerator<void> {
  const link = action.payload[0];
  const { navigateToSettings } = yield* call(() => import('$lib/utils/workspace-navigation'));
  yield* call(navigateToSettings, { tab: 'devices' });
  const inspected: PairLinkInspected = {
    ok: true,
    pendingId: link.pendingId,
    kind: 'node',
    label: link.label,
    existingId: link.existingId,
  };
  const error = yield* call(addInspected, inspected);
  if (error) yield* call(notify.error, nodeLinkErrorMessage({ ...error, node: link.label }));
}

/** The Add machine dialog (or Connect on an undetected row) reached a node instead of a backend. */
function* openedNode(action: ReturnType<typeof nodeConnectionOpened>): SagaGenerator<void> {
  const [connectionId, added] = action.payload;
  const connection = getItem(store.state.connections.connections, connectionId) ?? null;
  const label = connection ? formatConnectionLabel(connection) : connectionId;
  const support = yield* call(nodeSupport);
  if (support !== 'ok') {
    if (!added) return;
    yield* put(forgetConnectionRequested(connectionId));
    yield* call(notify.error, nodeLinkErrorMessage({ code: support, node: label }));
    return;
  }
  const { navigateToSettings } = yield* call(() => import('$lib/utils/workspace-navigation'));
  yield* call(navigateToSettings, { tab: 'devices' });
  yield* call(highlight, connectionId);
  if (connection) yield* call(promptForNode, connection, label);
}

export function* nodesSaga(): SagaGenerator<void> {
  yield* takeLatest(
    [pasteLinkRequested, pasteLinkSubmitted, pasteLinkRetried],
    function* (action): SagaGenerator<void> {
      if (action.type === pasteLinkRequested.toString()) yield* call(requestPaste);
      else if (action.type === pasteLinkSubmitted.toString())
        yield* call(submitPaste, action as ReturnType<typeof pasteLinkSubmitted>);
      else yield* call(retryPaste);
    },
  );
  yield* takeLatest(nodeLinkReceived, receiveNodeLink);
  yield* takeLatest(nodeConnectionOpened, openedNode);
  yield* takeLatest(rowHighlighted, clearHighlight);
}
