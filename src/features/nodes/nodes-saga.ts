/**
 * Add a machine or node from an `intent://pair` link, or a machine from an
 * `intent://node` link (renderer).
 *
 * Main tests the link and keeps its credential (`connections:pair-link-*`);
 * this saga only handles the pending id, a masked copy for display, and the
 * decisions: a full daemon is saved at once; a node is saved only when the
 * current backend can run agents on other machines (else refused, nothing
 * saved), then the in-app prompt asks whether to make it available. Every
 * route asks: the paste item, the Add machine dialog and links opened from
 * outside the app.
 *
 * An `intent://node` link holds no owner token: main keeps it, this saga asks
 * "Make <machine> available to <backend>?" and the backend claims the invite.
 */

import {
  actionChannel,
  call,
  delay,
  fork,
  put,
  race,
  take,
  takeLatest,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionRecord } from '$shared/types/connections';
import type {
  NodeRefusal,
  PairLinkCommitResult,
  PairLinkInspectResult,
  PairLinkInspected,
} from '$shared/types/pair-link';
import type { NodeInviteClaimResult, NodeInviteInspectErrorCode } from '$shared/types/node-invite';
import type { SshSetupLink } from '$shared/types/machine-setup';
import { parseRemoteMachine } from '$shared/types/remote-machines';
import { isPairingUri, maskPairingUri } from '$shared/utils/pairing-uri';
import { isNodeInviteUri, maskNodeInviteUri } from '$shared/utils/node-invite-uri';
import { confirm } from '$lib/components/patterns/confirm';
import { notify } from '$lib/components/patterns/notify';
import { store } from '$store/renderer/store';
import {
  remoteMachineChanged,
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
  nodeInviteReceived,
  nodeLinkReceived,
  pasteClosed,
  pasteCompleted,
  pasteFailed,
  pasteFieldOpened,
  pasteLinkRetried,
  pasteLinkSubmitted,
  pasteTestingStarted,
  rowHighlighted,
} from './nodes-slice';
import type { NodeAddError } from './nodes-types';
import { selectNodeInviteRefusal, selectNodeRefusal } from './nodes-selectors';
import { nodeAddErrorMessage } from './node-add-errors';
import { takePastedLink } from './pasted-link';

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
const invokeInviteInspect = async (uri: string): Promise<unknown> =>
  bridge().invoke(IPC_CHANNELS.REMOTE_MACHINES.INVITE_INSPECT, { uri });
const invokeInviteClaim = async (pendingId: string): Promise<unknown> =>
  bridge().invoke(IPC_CHANNELS.REMOTE_MACHINES.INVITE_CLAIM, { pendingId });
const invokeInviteDiscard = async (pendingId: string): Promise<unknown> =>
  bridge().invoke(IPC_CHANNELS.REMOTE_MACHINES.INVITE_DISCARD, { pendingId });

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

/**
 * The refusal message: Labs off points to Settings → Labs; an unsupported
 * backend is named; an unknown mode asks to try again.
 */
export function nodeRefusalMessage(
  refusal: NodeRefusal | 'unknown',
  node: string,
  backend: string,
): string {
  if (refusal === 'unknown') return m.nodes_error_failed();
  return refusal === 'labs-off'
    ? m.nodes_error_labsOff({ node })
    : m.nodes_error_backendUnsupported({ node, backend });
}

/** Labs Remote agents is on and the current backend advertises `remoteMachines: 1`. */
function* nodeSupport(): SagaGenerator<'ok' | NodeRefusal> {
  return (yield* call(nodeRefusal)) ?? 'ok';
}

/**
 * Why the current backend can't use a node, or null when it can. A snapshot
 * that does not show support yet (just connected, or never loaded) is read
 * again before refusing, so every route decides the same way.
 */
export function* nodeRefusal(): SagaGenerator<NodeRefusal | null> {
  const refusal = yield* selectNodeRefusal.effect();
  if (refusal !== 'backend-unsupported') return refusal;
  yield* put(remoteMachinesRefreshRequested());
  yield* race({ loaded: take(remoteMachinesLoaded), timeout: delay(SNAPSHOT_WAIT_MS) });
  return yield* selectNodeRefusal.effect();
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
 * From the paste row, Cancel still applies while support is checked; once
 * the save starts it runs to the end. Returns the error to show, null once
 * saved (and prompted), or 'cancelled'.
 */
function* addInspected(
  inspected: PairLinkInspected,
  fromPaste = false,
): SagaGenerator<NodeAddError | null | 'cancelled'> {
  if (inspected.kind === 'node') {
    const checked = fromPaste
      ? yield* race({ support: call(nodeSupport), cancelled: take(pasteClosed) })
      : { support: yield* call(nodeSupport), cancelled: undefined };
    const support = checked.cancelled ? 'cancelled' : (checked.support ?? 'cancelled');
    if (support !== 'ok') {
      yield* call(invokeDiscard, inspected.pendingId);
      if (support === 'cancelled') return 'cancelled';
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

/** A tunnel-only link has no host to name the machine by. */
const inviteLabel = (label: unknown): string =>
  typeof label === 'string' && label.trim() ? label : m.nodes_invite_tunnelLabel();

type HeldInvite =
  | { ok: true; pendingId: string; label: string }
  | { ok: false; code: NodeInviteInspectErrorCode | 'failed' };

function inviteInspectReply(reply: unknown): HeldInvite {
  const value = (reply ?? {}) as Record<string, unknown>;
  if (value.ok === true && typeof value.pendingId === 'string')
    return { ok: true, pendingId: value.pendingId, label: inviteLabel(value.label) };
  if (value.code === 'not-a-link' || value.code === 'incomplete' || value.code === 'link-version')
    return { ok: false, code: value.code };
  return { ok: false, code: 'failed' };
}

const CLAIM_CODES: ReadonlySet<string> = new Set([
  'node-invite-invalid',
  'node-invite-expired',
  'node-invite-used',
  'node-invite-revoked',
  'node-invite-self',
  'machine-unreachable',
  'machine-update-required',
  'certificate-mismatch',
  'expired',
]);

/** A claim failure as shown to the user; the backend's own names stay in main. */
function claimError(reply: unknown, node: string): NodeAddError | null {
  const value = (reply ?? {}) as Partial<NodeInviteClaimResult> & Record<string, unknown>;
  if (value.ok === true && parseRemoteMachine(value.machine)) return null;
  const code = typeof value.code === 'string' ? value.code : 'failed';
  const routes = Array.isArray(value.routes)
    ? value.routes.filter((route): route is string => typeof route === 'string')
    : [];
  if (code === 'backend-unsupported') return { code: 'invites-unsupported', node };
  if (code === 'not-owner') return { code: 'invite-not-owner', node };
  if (code === 'invalid-node-link') return { code: 'incomplete', node };
  if (!CLAIM_CODES.has(code)) return { code: 'failed', node };
  return {
    code: code as NodeAddError['code'],
    node,
    ...(value.inviteSpent === true ? { inviteSpent: true } : {}),
    ...(code === 'machine-unreachable' && routes.length ? { routes } : {}),
  };
}

/**
 * Labs Remote agents is on and the backend can claim node links. A snapshot
 * that does not show it yet is read again before refusing.
 */
function* inviteSupport(): SagaGenerator<'ok' | NodeRefusal | 'invites-unsupported'> {
  const refusal = yield* selectNodeInviteRefusal.effect();
  if (refusal === null || refusal === 'labs-off') return refusal ?? 'ok';
  yield* put(remoteMachinesRefreshRequested());
  yield* race({ loaded: take(remoteMachinesLoaded), timeout: delay(SNAPSHOT_WAIT_MS) });
  return (yield* selectNodeInviteRefusal.effect()) ?? 'ok';
}

/**
 * Ask, then claim a held node link on the current backend. Refused (and
 * dropped) when the backend can't use the machine. From the paste row,
 * Cancel stops it before the claim; during the claim it only closes the row
 * (a machine still added is listed). Returns the error to show, null once
 * claimed, or 'cancelled'.
 */
function* claimInvite(
  held: { pendingId: string; label: string },
  masked: string | null = null,
): SagaGenerator<NodeAddError | null | 'cancelled'> {
  const fromPaste = masked !== null;
  const checked = fromPaste
    ? yield* race({ support: call(inviteSupport), cancelled: take(pasteClosed) })
    : { support: yield* call(inviteSupport), cancelled: undefined };
  const support = checked.cancelled ? 'cancelled' : (checked.support ?? 'cancelled');
  if (support !== 'ok') {
    yield* call(invokeInviteDiscard, held.pendingId);
    return support === 'cancelled' ? 'cancelled' : { code: support, node: held.label };
  }
  const backend = selectCurrentBackendLabel.select(store.state);
  const accepted = yield* call(confirm, {
    title: m.nodes_prompt_title({ node: held.label, backend }),
    description: m.nodes_invite_prompt_description({ node: held.label, backend }),
    confirmLabel: m.nodes_prompt_confirm_label(),
    cancelLabel: m.nodes_paste_cancel_label(),
  });
  if (!accepted) {
    yield* call(invokeInviteDiscard, held.pendingId);
    if (fromPaste) yield* put(pasteClosed());
    return 'cancelled';
  }
  if (masked !== null) yield* put(pasteTestingStarted(masked));
  let request: Promise<unknown>;
  try {
    request = invokeInviteClaim(held.pendingId).catch(() => ({ ok: false, code: 'failed' }));
  } catch {
    request = Promise.resolve({ ok: false, code: 'failed' });
  }
  // The backend can't be stopped once it claims: Cancel only closes the row.
  let dismissed = false;
  let reply: unknown;
  if (fromPaste) {
    const claimed = yield* race({ reply: call(() => request), closed: take(pasteClosed) });
    dismissed = !!claimed.closed;
    reply = dismissed ? yield* call(() => request) : claimed.reply;
  } else {
    reply = yield* call(() => request);
  }
  const error = claimError(reply, held.label);
  if (error) return dismissed ? 'cancelled' : error;
  const machine = parseRemoteMachine((reply as { machine: unknown }).machine)!;
  yield* put(remoteMachineChanged(machine));
  yield* call(highlight, machine.id);
  if (fromPaste) {
    lastPasted = null;
    if (!dismissed) yield* put(pasteCompleted());
  }
  return null;
}

/** One pasted `intent://node` link: main holds it, then ask and claim. */
function* pasteInvite(text: string): SagaGenerator<void> {
  let held: HeldInvite;
  try {
    held = inviteInspectReply(yield* call(invokeInviteInspect, text));
  } catch {
    held = { ok: false, code: 'failed' };
  }
  if (!held.ok) {
    yield* put(pasteFailed({ code: held.code }));
    return;
  }
  const error = yield* call(claimInvite, held, maskNodeInviteUri(text));
  if (error === 'cancelled') lastPasted = null;
  else if (error) yield* put(pasteFailed(error));
}

/** Drop a credential main tested for a paste the user already cancelled. */
function discardLate(request: Promise<unknown>) {
  request
    .then((reply) => {
      const inspected = inspectReply(reply);
      if (inspected.ok) void invokeDiscard(inspected.pendingId);
    })
    .catch(() => {});
}

/** One paste attempt. Cancel stops it before anything is saved. */
function* testPasted(text: string): SagaGenerator<void> {
  lastPasted = text;
  if (isNodeInviteUri(text)) {
    yield* call(pasteInvite, text);
    return;
  }
  if (!isPairingUri(text)) {
    yield* put(pasteFieldOpened());
    yield* put(pasteFailed({ code: 'not-a-link' }));
    return;
  }
  yield* put(pasteTestingStarted(maskPairingUri(text)));
  let request: Promise<unknown>;
  try {
    request = invokeInspect(text);
  } catch {
    request = Promise.resolve({ ok: false, code: 'failed' });
  }
  const tested = yield* race({
    reply: call(() => request.catch(() => ({ ok: false, code: 'failed' }))),
    cancelled: take(pasteClosed),
  });
  if (tested.cancelled) {
    lastPasted = null;
    discardLate(request);
    return;
  }
  const inspected = inspectReply(tested.reply);
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
  if (error === 'cancelled') lastPasted = null;
  else if (error) yield* put(pasteFailed(error));
}

/**
 * Add a link main captured itself (SSH machine setup): a held pair link is
 * saved (a node only when the backend can use it, then the prompt); a held
 * node invite is asked about and claimed. Returns the error to show, null
 * once added, or 'cancelled' when the user declined the node prompt.
 */
export function* addHeldLink(link: SshSetupLink): SagaGenerator<NodeAddError | null | 'cancelled'> {
  if (link.kind === 'invite')
    return yield* call(claimInvite, { pendingId: link.pendingId, label: inviteLabel(link.label) });
  return yield* call(addInspected, {
    ok: true as const,
    pendingId: link.pendingId,
    kind: link.machineKind,
    label: link.label,
    existingId: link.existingId,
  });
}

function* submitPaste(): SagaGenerator<void> {
  const text = takePastedLink();
  if (text !== null) yield* call(testPasted, text);
}

function* retryPaste(): SagaGenerator<void> {
  if (lastPasted) yield* call(testPasted, lastPasted);
}

function nodeLinkErrorMessage(error: NodeAddError): string {
  return nodeAddErrorMessage(error, selectCurrentBackendLabel.select(store.state));
}

/** An `intent://node` link opened from outside the app: Settings → Machines, ask, claim. */
function* receiveNodeInvite(action: ReturnType<typeof nodeInviteReceived>): SagaGenerator<void> {
  const held = { ...action.payload[0], label: inviteLabel(action.payload[0].label) };
  const { navigateToSettings } = yield* call(() => import('$lib/utils/workspace-navigation'));
  yield* call(navigateToSettings, { tab: 'devices' });
  const error = yield* call(claimInvite, held);
  if (error && error !== 'cancelled') yield* call(notify.error, nodeLinkErrorMessage(error));
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
  if (error && error !== 'cancelled')
    yield* call(notify.error, nodeLinkErrorMessage({ ...error, node: link.label }));
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

/** Outside links and dialog hand-offs run one at a time, so each one gets its prompt. */
function* queueNodeHandoffs(): SagaGenerator<void> {
  const handoffs = yield* actionChannel([
    nodeLinkReceived,
    nodeInviteReceived,
    nodeConnectionOpened,
  ]);
  while (true) {
    const action = yield* take(handoffs);
    try {
      if (action.type === nodeLinkReceived.toString())
        yield* call(receiveNodeLink, action as ReturnType<typeof nodeLinkReceived>);
      else if (action.type === nodeInviteReceived.toString())
        yield* call(receiveNodeInvite, action as ReturnType<typeof nodeInviteReceived>);
      else yield* call(openedNode, action as ReturnType<typeof nodeConnectionOpened>);
    } catch {
      // One failed hand-off must not stop the queue.
    }
  }
}

export function* nodesSaga(): SagaGenerator<void> {
  // Leading: a new paste request is ignored while one is being tested or saved.
  yield* takeLeading(
    [pasteLinkSubmitted, pasteLinkRetried],
    function* (action): SagaGenerator<void> {
      if (action.type === pasteLinkSubmitted.toString()) yield* call(submitPaste);
      else yield* call(retryPaste);
    },
  );
  yield* fork(queueNodeHandoffs);
  yield* takeLatest(rowHighlighted, clearHighlight);
}
