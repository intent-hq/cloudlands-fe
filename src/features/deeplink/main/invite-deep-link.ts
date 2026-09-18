/**
 * Main-process handler for `intent://invite?...` deep links (multiplayer,
 * intentd #1872 / #1967) — the guest side of a workspace invite. Modelled on
 * `pair-deep-link.ts`, with a gist identity proof in the middle:
 *
 * 0. Returning guest (spec "Returning guest: per-host reuse"): when the
 *    guest-sessions store already holds a credential for this daemon
 *    (fingerprint canonical, host:port fallback) AND that record's pinned
 *    fingerprint equals the invite's, the invite is previewed with
 *    `invite.inspect` — no proof made. A workspace the session already lists
 *    just opens; otherwise a confirm-only consent prompt ("Signed in on this
 *    host as @login" → Join) leads to `invite.accept { inviteId, secret,
 *    credential }`, and the fresh credential is stored over the old one
 *    (same record, workspace appended). No session, a fingerprint mismatch
 *    (a different daemon at a known address — the stored token is never
 *    decrypted, let alone sent to it), an undecryptable token, or a
 *    `credential-invalid` refusal fall through to the proof below without an
 *    extra prompt.
 * 1. Parse the link and dial the daemon's unauthenticated `/invite`
 *    endpoint with the pin enforced at the TLS handshake, then
 *    `invite.challenge { inviteId, secret }` for the invite's preview and a
 *    short-lived single-use nonce. No fingerprint confirmation is asked of
 *    the user — the pin is checked mechanically at the handshake, not by eye.
 * 2. Read the GitHub account the guest's OWN daemon is signed in as
 *    (`github.getUser` — the same `GET /user` probe `github.authStatus`
 *    reduces to `isConfigured`, but returning the login the prove prompt
 *    names). Not signed in — or, later, a token that predates the
 *    `gist` scope the proof needs (`github-scope-missing`) — puts the consent
 *    modal in its `sign-in-required` state: the guest's own `github.connect`
 *    device flow (code copied to the clipboard; "Open GitHub" opens the URL)
 *    is awaited while the modal shows "waiting for GitHub". This prompt
 *    appears only at join time, never at startup.
 * 3. Consent proper: the modal's `prove` state ("Join <title> on <host> as
 *    @login", "what the host learns", Join). It renders in the renderer
 *    (`main/invite-consent.ts`, `invite-consent:*` channels) and stays up in
 *    a "joining" state while the proof runs; with no window or no ack it
 *    falls back to the native message box so a cold start from a link never
 *    hangs.
 * 4. The proof: `github.identityProof.create { nonce, hostLabel }` publishes
 *    the nonce in a private gist on the guest's account, `invite.prove
 *    { inviteId, secret, nonce, gistId, login }` has the host read it, and
 *    `github.identityProof.delete { gistId }` removes it afterwards (best
 *    effort, after the store write — a delete failure never fails the join).
 *    A `proof-expired` or `proof-invalid` refusal offers one retry with a
 *    fresh challenge: a nonce purged by a later challenge surfaces as
 *    `proof-invalid`, so both mean "restart the challenge".
 * 5. The prove answer is the point of no return: the host has minted the
 *    credential and consumed a seat, so the modal is dismissed (`joined`) the
 *    moment it resolves and a Cancel from then on is ignored. Store the
 *    minted credential as a GUEST session — never in the paired backend
 *    registry — and open the daemon's window; a store failure after the
 *    grant surfaces as a failure, never as a cancellation.
 *
 * Security posture mirrors the pair flow: the invite secret and the minted
 * token are never logged — failures are logged as bounded error kinds and
 * codes, never as free-form message text (a server or encryption error
 * string could echo a credential) — a link that pins a certificate the host
 * does not present is refused before a byte of the secret leaves this
 * process, the daemon-supplied verification URL is opened only when it is
 * an `https://github.com` URL (anything else fails the flow — the daemon
 * never sends another origin, and a compromised one must not be able to
 * launch arbitrary URLs), and everything fails soft — a bad link logs a
 * warning and returns; the app never crashes on it.
 */
import { app, clipboard, dialog, shell, type MessageBoxOptions } from 'electron';
import { randomUUID } from 'node:crypto';

import type { InviteConsentShowPayload, InviteSignInReason } from '$shared/ipc/invite-consent';
import { Logger } from '$shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { isTcAddress } from '$shared/tc-address';
import { parseInviteUri } from '$shared/utils/invite-uri';
import { showInviteConsent, type InviteConsentPrompt } from '../../../main/invite-consent';
import { getMainWindow } from '../../../main/state';
import * as guestSessionsStore from '../../backend/main/guest-sessions-store';
import {
  getBackendClient,
  onBackendNotification,
  openBackendWindow,
} from '../../backend/main/backend.ipc';
import { PinMismatchError, normalizeFingerprint } from '../../backend/main/backend-connection';
import {
  InviteRpcError,
  InviteTransportError,
  openInviteConnection,
  type InviteChallenge,
  type InviteConnection,
  type InviteInspection,
} from '../../backend/main/invite-connection';
import type { JsonRpcClient } from '../../backend/main/json-rpc-client';
import { JsonRpcError } from '../../backend/main/json-rpc-errors';
import { isAllowedVerificationUri } from '../utils/verification-uri';

const logger = new Logger('InviteDeepLink');

/** Local bound on the sign-in wait beyond the daemon's own `expiresIn`. */
const WAIT_MARGIN_MS = 60_000;

/** Floor on the `github.authStatus` poll that backs the `github:auth-changed` event. */
const SIGN_IN_POLL_FLOOR_MS = 5_000;

/** The parsed link fields the join paths need. */
interface InviteEnvelope {
  hosts: string[];
  port: number;
  fingerprint: string;
  tcAddress: string | null;
  inviteId: string;
  secret: string;
}

/** Display labels of the consent prompts, derived once per join. */
interface PromptLabels {
  workspaceTitle: string;
  hostLabel: string;
}

/**
 * Why the returning-guest path did not complete the join, as a bounded code
 * for the log: every one of these falls through to the identity proof.
 */
type ReturningFallbackReason =
  'no-session' | 'fingerprint-mismatch' | 'no-token' | 'token-unavailable' | 'credential-invalid';

/**
 * Outcome of the returning-guest attempt: `handled` ends the flow (window
 * opened or user cancelled); `fallback` continues into the identity proof.
 */
type ReturningOutcome = { kind: 'handled' } | { kind: 'fallback'; reason: ReturningFallbackReason };

/**
 * A flow failure decided locally, identified by a bounded code so logs and
 * the failure dialog route on it without any free-form text. The `sign-in-*`
 * codes are the guest's own `github.connect` device flow ending without a
 * token (GitHub denied it, the code expired, the daemon reported an error or
 * could not start / finish the flow at all).
 */
type InviteFlowCode =
  | 'invalid-verification-uri'
  | 'verification-launch-failed'
  | 'sign-in-denied'
  | 'sign-in-expired'
  | 'sign-in-failed';

class InviteFlowError extends Error {
  constructor(readonly flowCode: InviteFlowCode) {
    // i18n-ignore (internal error, fixed text)
    super('invite flow refused');
    this.name = 'InviteFlowError';
  }
}

/**
 * The guest daemon's documented `error.data.code` values for
 * `github.identityProof.create` / `.delete` (intentd #1967). Like the host's
 * invite codes, the closed set is the only daemon-authored text that leaves
 * {@link IdentityProofError}; anything else maps to `null`.
 */
const IDENTITY_PROOF_ERROR_CODES = [
  'github-not-connected',
  'github-scope-missing',
  'github-unreachable',
] as const;

type IdentityProofErrorCode = (typeof IDENTITY_PROOF_ERROR_CODES)[number];

/**
 * A `github.identityProof.*` call on the guest's own daemon failed: the
 * daemon's bounded code when it sent one, else `null` (transport, a daemon
 * that is not running, an undocumented error). The message text is dropped.
 */
class IdentityProofError extends Error {
  constructor(readonly proofCode: IdentityProofErrorCode | null) {
    // i18n-ignore (internal error, fixed text)
    super('identity proof failed');
    this.name = 'IdentityProofError';
  }

  /** Reduce a thrown value to its bounded code (an `IdentityProofError` passes through). */
  static from(error: unknown): IdentityProofError {
    if (error instanceof IdentityProofError) return error;
    const code = error instanceof JsonRpcError ? error.code : null;
    return new IdentityProofError(
      typeof code === 'string' && (IDENTITY_PROOF_ERROR_CODES as readonly string[]).includes(code)
        ? (code as IdentityProofErrorCode)
        : null,
    );
  }
}

/**
 * The consent prompts of one join, in order. Showing the next prompt ends
 * the previous one as `superseded` (after the renderer already shows the new
 * request, so it never flickers closed), unless the flow already dismissed
 * it; `current()` is what the failure path dismisses.
 */
interface ConsentPrompts {
  show(payload: InviteConsentShowPayload): InviteConsentPrompt;
  current(): InviteConsentPrompt | null;
}

function createConsentPrompts(): ConsentPrompts {
  let current: InviteConsentPrompt | null = null;
  return {
    show(payload) {
      const prompt = showInviteConsent(payload);
      const previous = current;
      let ended = false;
      const handle: InviteConsentPrompt = {
        decision: prompt.decision,
        cancelledWhileWaiting: prompt.cancelledWhileWaiting,
        dismiss(outcome) {
          if (ended) return;
          ended = true;
          prompt.dismiss(outcome);
          if (current === handle) current = null;
        },
      };
      current = handle;
      previous?.dismiss('superseded');
      return handle;
    },
    current: () => current,
  };
}

/**
 * In-flight guard (same rationale as the pair flow): a second invite link
 * while one is being redeemed is dropped instead of stacking dialogs.
 */
let inviteLinkInFlight = false;

/**
 * Handle an `intent://invite?...` deep link end to end. Resolves once the
 * flow completes (window opened, dialog cancelled, or link rejected); never
 * rejects — failures are logged (scrubbed) and surfaced in a native dialog.
 */
export async function handleInviteDeepLink(url: string): Promise<void> {
  if (inviteLinkInFlight) {
    logger.info('Ignoring invite link while another is being handled');
    return;
  }
  inviteLinkInFlight = true;
  let connection: InviteConnection | null = null;
  const prompts = createConsentPrompts();
  try {
    const parsed = parseInviteUri(url);
    if (!parsed) {
      logger.warn('Ignoring deep link that is not an invite URI');
      return;
    }
    const { hosts, port, fingerprint, inviteId, secret, tcAddress } = parsed;
    // The daemon's default (loopback-bound) invite carries no direct host at
    // all — `host=` empty, `tc=` set — so a tunnel address satisfies the
    // "somewhere to dial" requirement on its own.
    const displayHost = hosts[0] ?? tcAddress;
    if (displayHost == null || port === null || fingerprint === null || !inviteId || !secret) {
      // Presence booleans only — never the values (the secret must not leak).
      logger.warn('Ignoring invite link with missing required fields', {
        hasHost: hosts.length > 0,
        hasTunnel: tcAddress !== null,
        hasPort: port !== null,
        hasFingerprint: fingerprint !== null,
        hasInviteId: !!inviteId,
        hasSecret: !!secret,
      });
      return;
    }

    const envelope: InviteEnvelope = { hosts, port, fingerprint, tcAddress, inviteId, secret };
    connection = await openInviteConnection({ hosts, port, fingerprint, tcAddress });
    const returning = await joinAsReturningGuest(connection, envelope, prompts);
    if (returning.kind === 'handled') return;
    logger.info('No usable stored credential for this host; proving identity through GitHub', {
      reason: returning.reason,
    });
    await joinWithIdentityProof(connection, envelope, prompts);
  } catch (error) {
    logger.warn('Invite deep link handling failed', describeErrorForLog(error));
    // A no-op once the modal was dismissed `joined`; the failure box still shows.
    prompts.current()?.dismiss('failed');
    await showFailure(error);
  } finally {
    connection?.close();
    inviteLinkInFlight = false;
  }
}

/** How one proof attempt ended; every kind but `joined` leaves nothing minted. */
type ProveOutcome =
  | { kind: 'joined' }
  | { kind: 'cancelled' }
  | { kind: 'sign-in-required'; reason: InviteSignInReason }
  | { kind: 'proof-refused'; code: ProofRefusalCode }
  | { kind: 'account-changed'; login: string };

/** Host refusals of the proof that a fresh challenge can cure. */
type ProofRefusalCode = 'proof-invalid' | 'proof-expired';

/**
 * First join on a host: challenge → (sign in) → consent → create → prove →
 * delete. The loop re-enters the sign-in step when the guest daemon refuses
 * to create the proof for want of a token or of the `gist` scope — once: a
 * second refusal after a completed sign-in is surfaced as a failure rather
 * than prompting again — and re-challenges once on `proof-expired` /
 * `proof-invalid` when the user asks to retry (consent already given: no
 * second prompt). Consent is bound to a login: when the proof comes back
 * under a different account than the one consented to, the loop prompts
 * again naming that account before anything is proven to the host.
 */
async function joinWithIdentityProof(
  connection: InviteConnection,
  envelope: InviteEnvelope,
  prompts: ConsentPrompts,
): Promise<void> {
  const { inviteId, secret } = envelope;
  const client = getBackendClient();
  let challenge = await connection.challenge(inviteId, secret);
  const labels: PromptLabels = {
    hostLabel: hostLabelFor(connection, challenge),
    workspaceTitle: nonBlank(challenge.workspaceTitle) ?? m.workspace_links_untitled_label(),
  };

  let login = await readLocalLogin(client);
  let signInReason: InviteSignInReason | null = login === null ? 'not-connected' : null;
  let signedIn = false;
  let consented = false;
  let retried = false;
  let consent: InviteConsentPrompt | null = null;
  for (;;) {
    if (signInReason !== null) {
      if (signedIn) {
        throw new IdentityProofError(
          signInReason === 'scope-missing' ? 'github-scope-missing' : 'github-not-connected',
        );
      }
      const signIn = await signInToGitHub(client, signInReason, labels, prompts);
      if (signIn.kind === 'cancelled') return;
      signedIn = true;
      login = signIn.login;
      signInReason = null;
      // The account may differ from the one first read: consent names it anew.
      consented = false;
    }
    if (!consented) {
      consent = prompts.show({
        requestId: randomUUID(),
        mode: 'prove',
        login: login as string,
        ...labels,
      });
      const decision = await consent.decision;
      if (decision === 'cancel') {
        consent.dismiss('cancelled');
        logger.info('User cancelled the invite before proving identity');
        return;
      }
      // No renderer to show the modal (cold start / no ack): native box.
      if (decision === null && !(await showConfirmProve(login as string, labels.workspaceTitle))) {
        logger.info('User cancelled the invite before proving identity');
        return;
      }
      consented = true;
    }
    const outcome = await proveIdentity(
      connection,
      client,
      envelope,
      challenge,
      labels,
      login as string,
      consent,
    );
    switch (outcome.kind) {
      case 'joined':
      case 'cancelled':
        return;
      case 'sign-in-required':
        // The joining prompt stays up until the sign-in prompt supersedes it.
        signInReason = outcome.reason;
        break;
      case 'account-changed':
        login = outcome.login;
        consent = null;
        consented = false;
        break;
      case 'proof-refused':
        consent?.dismiss('failed');
        consent = null;
        if (retried) throw new InviteRpcError(-32602, { code: outcome.code });
        if (!(await showProofRefusedRetry(outcome.code))) {
          logger.info('User declined to retry the refused identity proof', {
            code: outcome.code,
          });
          return;
        }
        retried = true;
        challenge = await connection.challenge(inviteId, secret);
        break;
    }
  }
}

/**
 * One proof attempt against the current challenge. `consent` is the prompt
 * in its waiting state (or `null` on a retry, when nothing is up): a Cancel
 * that lands before `invite.prove` is sent aborts the attempt — the gist is
 * deleted — while the prove answer is the point of no return. `login` is the
 * account the user consented to: a proof the guest daemon creates under any
 * other account is deleted, unproven, and reported as `account-changed` so
 * the host never learns an account the user did not approve. The gist is
 * deleted best-effort on every path but `sign-in-required` (where none was
 * created).
 */
async function proveIdentity(
  connection: InviteConnection,
  client: JsonRpcClient,
  envelope: InviteEnvelope,
  challenge: InviteChallenge,
  labels: PromptLabels,
  login: string,
  consent: InviteConsentPrompt | null,
): Promise<ProveOutcome> {
  let cancelled = false;
  void consent?.cancelledWhileWaiting.then(() => {
    cancelled = true;
  });

  let proof: { gistId: string; login: string };
  try {
    proof = await client.request<{ gistId: string; login: string }>('github.identityProof.create', {
      nonce: challenge.nonce,
      hostLabel: labels.hostLabel,
    });
  } catch (error) {
    const refusal = IdentityProofError.from(error);
    if (refusal.proofCode === 'github-scope-missing') {
      return { kind: 'sign-in-required', reason: 'scope-missing' };
    }
    if (refusal.proofCode === 'github-not-connected') {
      return { kind: 'sign-in-required', reason: 'not-connected' };
    }
    throw refusal;
  }
  if (cancelled) {
    void deleteProof(client, proof.gistId);
    consent?.dismiss('cancelled');
    logger.info('User cancelled the invite while the identity proof was being made');
    return { kind: 'cancelled' };
  }
  if (proof.login !== login) {
    void deleteProof(client, proof.gistId);
    consent?.dismiss('superseded');
    logger.info('Identity proof named a different GitHub account than consented; asking again');
    return { kind: 'account-changed', login: proof.login };
  }

  let credential: Awaited<ReturnType<InviteConnection['prove']>>;
  try {
    credential = await connection.prove(envelope.inviteId, envelope.secret, {
      nonce: challenge.nonce,
      gistId: proof.gistId,
      login: proof.login,
    });
  } catch (error) {
    void deleteProof(client, proof.gistId);
    if (
      error instanceof InviteRpcError &&
      (error.inviteCode === 'proof-expired' || error.inviteCode === 'proof-invalid')
    ) {
      return { kind: 'proof-refused', code: error.inviteCode };
    }
    throw error;
  }
  // Point of no return: the host has minted the credential and consumed a
  // seat. Close the modal now — before the asynchronous store write — so
  // Cancel is neither offered nor honoured while the credential persists.
  consent?.dismiss('joined');
  await storeCredentialAndOpen(connection, envelope, credential, challenge.workspaceTitle, () =>
    deleteProof(client, proof.gistId),
  );
  return { kind: 'joined' };
}

/** Wire shape of `github.connect` (PROTOCOL §5.27): the guest's own device flow. */
interface GithubConnectResult {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** The `github.authStatus` fields the sign-in wait reads (PROTOCOL §5.27). */
interface GithubAuthStatusResult {
  isConfigured?: boolean;
  deviceFlow?: { status?: string } | null;
}

/** Terminal states of the guest's own device flow, as `github:auth-changed` names them. */
type SignInStatus = 'authorized' | 'denied' | 'expired' | 'error';

type SignInResult = { kind: 'signed-in'; login: string } | { kind: 'cancelled' };

/**
 * Sign the guest's own daemon in to GitHub from the consent modal's
 * `sign-in-required` state: `github.connect` starts the device flow, the
 * modal shows the code + URL (code copied to the clipboard), "Open GitHub"
 * launches the URL and the flow's terminal transition is awaited. Cancel
 * (before or while waiting) aborts the flow locally (`github.cancelAuth`,
 * best effort). Resolves with the login the daemon is now signed in as.
 */
async function signInToGitHub(
  client: JsonRpcClient,
  reason: InviteSignInReason,
  labels: PromptLabels,
  prompts: ConsentPrompts,
): Promise<SignInResult> {
  let start: GithubConnectResult;
  try {
    start = await client.request<GithubConnectResult>('github.connect');
  } catch {
    throw new InviteFlowError('sign-in-failed');
  }
  if (
    typeof start?.userCode !== 'string' ||
    typeof start.verificationUri !== 'string' ||
    typeof start.expiresIn !== 'number'
  ) {
    throw new InviteFlowError('sign-in-failed');
  }
  // Refuse before the URL is shown or opened: the dialog would otherwise
  // display (and "Open GitHub" launch) whatever the daemon sent.
  if (!isAllowedVerificationUri(start.verificationUri)) {
    throw new InviteFlowError('invalid-verification-uri');
  }
  const cancelSignIn = (): void => {
    void client.request('github.cancelAuth').catch(() => {});
  };

  await clipboard.writeText(start.userCode);
  const consent = prompts.show({
    requestId: randomUUID(),
    mode: 'sign-in-required',
    reason,
    userCode: start.userCode,
    verificationUri: start.verificationUri,
    expiresInMs: start.expiresIn * 1000,
    ...labels,
  });
  const decision = await consent.decision;
  if (decision === 'cancel') {
    consent.dismiss('cancelled');
    cancelSignIn();
    logger.info('User cancelled the GitHub sign-in the invite needs');
    return { kind: 'cancelled' };
  }
  // No renderer to show the modal (cold start / no ack): native box.
  if (
    decision === null &&
    !(await showDeviceCode(start.userCode, start.verificationUri, labels.workspaceTitle))
  ) {
    cancelSignIn();
    logger.info('User cancelled the GitHub sign-in the invite needs');
    return { kind: 'cancelled' };
  }
  // From here the modal stays up in its waiting state. Cancel and the flow's
  // end are raced from the browser launch onwards — whichever settles first
  // decides — so a cancel still aborts even if the launch never settles.
  const cancelSignal = consent.cancelledWhileWaiting.then(() => 'cancelled' as const);
  const wait = waitForSignIn(
    client,
    start.expiresIn * 1000 + WAIT_MARGIN_MS,
    Math.max((start.interval ?? 0) * 1000, SIGN_IN_POLL_FLOOR_MS),
  );
  const settled = wait.status.then((status) => ({ status }));
  // The OS error text is dropped (bounded code only): it may echo the URL.
  const launch = (async () => {
    try {
      await shell.openExternal(start.verificationUri);
      return 'launched' as const;
    } catch {
      return 'launch-failed' as const;
    }
  })();
  let outcome = await Promise.race([cancelSignal, settled, launch]);
  if (outcome === 'launched') {
    outcome = await Promise.race([cancelSignal, settled]);
  }
  if (outcome === 'cancelled') {
    wait.stop();
    consent.dismiss('cancelled');
    cancelSignIn();
    logger.info('User cancelled the invite while waiting for the GitHub sign-in');
    return { kind: 'cancelled' };
  }
  if (outcome === 'launch-failed') {
    wait.stop();
    cancelSignIn();
    throw new InviteFlowError('verification-launch-failed');
  }
  switch (outcome.status) {
    case 'denied':
      throw new InviteFlowError('sign-in-denied');
    case 'expired':
    case 'timeout':
      cancelSignIn();
      throw new InviteFlowError('sign-in-expired');
    case 'error':
      throw new InviteFlowError('sign-in-failed');
    case 'authorized':
      break;
  }
  const login = await readLocalLogin(client);
  if (login === null) throw new InviteFlowError('sign-in-failed');
  logger.info('Guest daemon signed in to GitHub for the invite', { reason });
  // The consent for the join itself follows as its own prompt (it names the
  // account just signed in); this one is superseded by it.
  return { kind: 'signed-in', login };
}

/**
 * Wait for the guest daemon's device flow to end: the `github:auth-changed`
 * event names the terminal status, and `github.authStatus` is polled at the
 * daemon's `interval` (floored) as a fallback for a missed event or a flow
 * that ended before the listener was attached. `timeoutMs` bounds the wait
 * locally beyond the code's own lifetime; `stop()` releases the listener and
 * timers when the caller gives up first (`status` then never settles).
 */
function waitForSignIn(
  client: JsonRpcClient,
  timeoutMs: number,
  pollMs: number,
): { status: Promise<SignInStatus | 'timeout'>; stop(): void } {
  let settled = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let off: (() => void) | undefined;
  let resolveStatus!: (status: SignInStatus | 'timeout') => void;
  const status = new Promise<SignInStatus | 'timeout'>((resolve) => {
    resolveStatus = resolve;
  });
  const stop = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    clearTimeout(pollTimer);
    off?.();
  };
  const finish = (outcome: SignInStatus | 'timeout'): void => {
    if (settled) return;
    stop();
    resolveStatus(outcome);
  };
  deadline = setTimeout(() => finish('timeout'), timeoutMs);
  off = onBackendNotification((notification) => {
    if (notification.method !== 'events.event' || !notification.params) return;
    const params = notification.params as { event?: unknown };
    const event = (params.event ?? params) as { type?: unknown; data?: { status?: unknown } };
    if (event.type !== 'github:auth-changed') return;
    const outcome = event.data?.status;
    if (
      outcome === 'authorized' ||
      outcome === 'denied' ||
      outcome === 'expired' ||
      outcome === 'error'
    ) {
      finish(outcome);
    }
  });
  const poll = async (): Promise<void> => {
    if (settled) return;
    try {
      const result = await client.request<GithubAuthStatusResult>('github.authStatus');
      if (settled) return;
      const flow = result?.deviceFlow?.status;
      if (flow === 'denied' || flow === 'expired' || flow === 'error') return finish(flow);
      if (flow !== 'pending' && result?.isConfigured === true) return finish('authorized');
    } catch {
      // The daemon may be briefly unreachable; the next poll or the event decides.
    }
    if (!settled) pollTimer = setTimeout(() => void poll(), pollMs);
  };
  pollTimer = setTimeout(() => void poll(), pollMs);
  return { status, stop };
}

/** The GitHub login the guest's own daemon is signed in as, or `null` when it is not. */
async function readLocalLogin(client: JsonRpcClient): Promise<string | null> {
  try {
    const result = await client.request<{ user?: { login?: unknown } | null }>('github.getUser');
    return nonBlank(result?.user?.login) ?? null;
  } catch {
    return null;
  }
}

/**
 * Remove the proof gist once the host has read it (or the attempt ended).
 * Best effort: a failure is logged by bounded code and never fails the join.
 */
async function deleteProof(client: JsonRpcClient, gistId: string): Promise<void> {
  try {
    await client.request('github.identityProof.delete', { gistId });
  } catch (error) {
    logger.warn('Could not delete the identity proof gist', {
      code: IdentityProofError.from(error).proofCode,
    });
  }
}

/**
 * The host's display name for the prompts and the proof gist's explanatory
 * line: the pretty name when the daemon sends one (older daemons omit it →
 * the dialed address, or "Unknown host" when that is an opaque tc address —
 * which must not be written into a gist either). The stored guest session
 * keeps the raw title and address; its settings row applies the same
 * fallbacks on render.
 */
function hostLabelFor(connection: InviteConnection, inspection: InviteInspection): string {
  return (
    nonBlank(inspection.prettyHostname) ??
    nonBlank(inspection.hostname) ??
    (isTcAddress(connection.host) ? m.connection_unknownHost_label() : connection.host)
  );
}

/**
 * Returning-guest attempt, run before the identity proof. Its consent prompt
 * goes through `prompts` so the caller's failure path can dismiss it when a
 * step after it throws. Refusals other than `credential-invalid` (expired /
 * revoked / redeemed invite, transport) propagate — they would refuse the
 * proof just the same.
 */
async function joinAsReturningGuest(
  connection: InviteConnection,
  envelope: InviteEnvelope,
  prompts: ConsentPrompts,
): Promise<ReturningOutcome> {
  const { hosts, port, fingerprint, inviteId, secret } = envelope;
  // The winning candidate (a direct host, or the tc address standing in as
  // the host) is what the store keyed a tunnel-only session on.
  const session = await guestSessionsStore.findMatching({
    hosts: [...new Set([connection.host, ...hosts])],
    port,
    fingerprint,
  });
  if (!session) return { kind: 'fallback', reason: 'no-session' };
  // Fail closed: the store's host:port fallback can match a record pinned to
  // a different cert at the same address. Only a session pinned to the exact
  // daemon this link is pinned to may have its credential reused.
  if (normalizeFingerprint(session.fingerprint) !== normalizeFingerprint(fingerprint)) {
    return { kind: 'fallback', reason: 'fingerprint-mismatch' };
  }
  let token: string | null;
  try {
    token = await guestSessionsStore.getDecryptedToken(session.id);
  } catch {
    // Keyring changed: the ciphertext is unreadable. A fresh proof re-mints
    // the credential; the store's upsert then replaces it.
    return { kind: 'fallback', reason: 'token-unavailable' };
  }
  if (token === null) return { kind: 'fallback', reason: 'no-token' };

  const inspection = await connection.inspect(inviteId, secret);
  if (session.workspaces.some((w) => w.id === inspection.workspaceId)) {
    logger.info('Already a member of the invited workspace on this host; opening the window', {
      id: session.id,
      workspaceId: inspection.workspaceId,
      via: connection.via,
    });
    await openBackendWindow(session.id);
    return { kind: 'handled' };
  }

  const hostLabel = hostLabelFor(connection, inspection);
  const workspaceTitle = nonBlank(inspection.workspaceTitle) ?? m.workspace_links_untitled_label();
  const consent = prompts.show({
    requestId: randomUUID(),
    mode: 'confirm',
    login: session.login,
    workspaceTitle,
    hostLabel,
  });
  const decision = await consent.decision;
  if (decision === 'cancel') {
    consent.dismiss('cancelled');
    logger.info('User cancelled the returning-guest join');
    return { kind: 'handled' };
  }
  // No renderer to show the modal (cold start / no ack): native box.
  if (decision === null && !(await showConfirmJoin(session.login, workspaceTitle))) {
    logger.info('User cancelled the returning-guest join');
    return { kind: 'handled' };
  }

  // As in the device flow, a Cancel from the waiting state aborts the join
  // until the host has answered: whichever of cancel and accept settles first
  // decides, and a cancel that lands first stores nothing.
  const accepted = connection.accept(inviteId, secret, token).then(
    (credential) => ({ credential }),
    (error: unknown) => {
      if (error instanceof InviteRpcError && error.inviteCode === 'credential-invalid') {
        return { credential: null };
      }
      throw error;
    },
  );
  accepted.catch(() => {});
  const outcome = await Promise.race([
    consent.cancelledWhileWaiting.then(() => 'cancelled' as const),
    accepted,
  ]);
  if (outcome === 'cancelled') {
    consent.dismiss('cancelled');
    logger.info('User cancelled the returning-guest join while waiting for the host');
    return { kind: 'handled' };
  }
  const { credential } = outcome;
  if (credential === null) {
    // The host no longer recognizes the stored credential (revoked, or the
    // guest was removed): the identity proof re-establishes identity.
    consent.dismiss('failed');
    return { kind: 'fallback', reason: 'credential-invalid' };
  }
  // Point of no return, as for the proof: the host has committed the join.
  // Close the modal before the store write.
  consent.dismiss('joined');
  await storeCredentialAndOpen(connection, envelope, credential, inspection.workspaceTitle);
  return { kind: 'handled' };
}

/**
 * Persist the minted credential as a GUEST session (the store upserts by
 * daemon identity: a returning guest's record keeps its id, takes the fresh
 * token, and gains the workspace) and open the daemon's window. A store
 * failure here surfaces as a failure, never as a cancellation. `afterStore`
 * runs once the write settled either way (the proof gist's cleanup: it must
 * not delay or fail the join, and the gist outliving a failed write by a
 * moment is harmless — the nonce is spent).
 */
async function storeCredentialAndOpen(
  connection: InviteConnection,
  envelope: Pick<InviteEnvelope, 'hosts' | 'port' | 'fingerprint' | 'tcAddress'>,
  credential: { token: string; principalId: string; login: string; workspaceId: string },
  workspaceTitle: string,
  afterStore?: () => Promise<void>,
): Promise<void> {
  let record: Awaited<ReturnType<typeof guestSessionsStore.add>>;
  try {
    record = await guestSessionsStore.add({
      label: connection.host,
      host: connection.host,
      hosts: envelope.hosts,
      port: envelope.port,
      fingerprint: envelope.fingerprint,
      tcAddress: envelope.tcAddress,
      principalId: credential.principalId,
      login: credential.login,
      token: credential.token,
      workspace: { id: credential.workspaceId, title: workspaceTitle },
    });
  } finally {
    void afterStore?.();
  }
  logger.info('Joined workspace as a guest; opening the window', {
    id: record.id,
    workspaceId: credential.workspaceId,
    via: connection.via,
    tokenEncrypted: record.tokenEncrypted,
  });
  if (!record.tokenEncrypted) {
    // Flagged plaintext fallback (spec ruling): the join stands, but the
    // user learns the credential is not protected by OS encryption.
    await showPlaintextWarning();
  }
  await openBackendWindow(record.id);
}

/**
 * Route an invite link arriving from the OS (macOS `open-url`): handled
 * whenever the app is ready (no window needed — dialogs show parentless and
 * `openBackendWindow` creates its own window); parked before ready.
 */
export async function routeInviteLinkFromOs(
  url: string,
  park: (url: string) => Promise<void>,
): Promise<void> {
  if (app.isReady()) {
    await handleInviteDeepLink(url);
    return;
  }
  await park(url);
}

/**
 * Bounded log fields for a failure: error class and closed-set codes only.
 * The message text is deliberately dropped — it is server- or
 * library-authored free-form text that may carry the invite secret or the
 * minted token — and so is anything on the error beyond a known code
 * (`InviteRpcError.inviteCode` and `IdentityProofError.proofCode` are already
 * reduced to their documented sets; `transportCode` / `flowCode` / `code`
 * below are local literals). Anything
 * else is logged as `unknown` — `Error.name` is arbitrary, writable text.
 */
function describeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof PinMismatchError) return { kind: 'pin-mismatch' };
  if (error instanceof InviteRpcError) {
    return { kind: 'rpc', rpcCode: error.code, inviteCode: error.inviteCode };
  }
  if (error instanceof InviteTransportError) {
    return { kind: 'transport', transportCode: error.transportCode };
  }
  if (error instanceof InviteFlowError) return { kind: 'flow', flowCode: error.flowCode };
  if (error instanceof IdentityProofError) return { kind: 'proof', proofCode: error.proofCode };
  if (error instanceof guestSessionsStore.GuestStoreCorruptError) {
    return { kind: 'store', code: error.code };
  }
  if (error instanceof guestSessionsStore.GuestEncryptionUnavailableError) {
    return { kind: 'store', code: error.code };
  }
  return { kind: 'unknown' };
}

/** The trimmed string, or `undefined` when absent, not a string, or whitespace-only. */
function nonBlank(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
}

async function showDialog(options: MessageBoxOptions): Promise<number> {
  const parent = getMainWindow();
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return result.response;
}

/** Sign-in prompt: user code + verification URL. True when the user chose "Open GitHub". */
async function showDeviceCode(
  userCode: string,
  verificationUri: string,
  workspaceTitle: string,
): Promise<boolean> {
  const response = await showDialog({
    type: 'info',
    title: m.deeplink_inviteCode_title(),
    message: m.deeplink_inviteCode_message({
      code: userCode,
      url: verificationUri,
      workspace: workspaceTitle,
    }),
    detail: m.deeplink_inviteCode_detail(),
    buttons: [m.deeplink_inviteCode_open_button(), m.deeplink_pairDialog_cancel_button()],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
}

/** Confirm-only prompt for a returning guest (no device code). True when the user chose "Join". */
async function showConfirmJoin(login: string, workspaceTitle: string): Promise<boolean> {
  const response = await showDialog({
    type: 'question',
    title: m.deeplink_inviteConfirm_title(),
    message: m.deeplink_inviteConfirm_message({ login: `@${login}`, workspace: workspaceTitle }),
    detail: m.deeplink_inviteConfirm_detail(),
    buttons: [m.deeplink_inviteConfirm_join_button(), m.deeplink_pairDialog_cancel_button()],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
}

/** First-join prompt: prove the signed-in GitHub account to the host. True when the user chose "Join". */
async function showConfirmProve(login: string, workspaceTitle: string): Promise<boolean> {
  const response = await showDialog({
    type: 'question',
    title: m.deeplink_inviteConfirm_title(),
    message: m.deeplink_inviteConfirm_message({ login: `@${login}`, workspace: workspaceTitle }),
    detail: m.deeplink_inviteProve_detail(),
    buttons: [m.deeplink_inviteConfirm_join_button(), m.deeplink_pairDialog_cancel_button()],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
}

/** The host refused the proof as expired or invalid. True when the user chose "Retry". */
async function showProofRefusedRetry(code: ProofRefusalCode): Promise<boolean> {
  const response = await showDialog({
    type: 'question',
    title: m.deeplink_inviteFailed_title(),
    message:
      code === 'proof-expired'
        ? m.deeplink_inviteProofExpired_message()
        : m.deeplink_inviteProofInvalid_message(),
    buttons: [m.deeplink_inviteProofExpired_retry_button(), m.deeplink_pairDialog_cancel_button()],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
}

/**
 * Warn that the credential was stored in plaintext because OS encryption is
 * unavailable on this machine (flagged fallback); the join itself stands.
 */
async function showPlaintextWarning(): Promise<void> {
  await showDialog({
    type: 'warning',
    title: m.deeplink_invitePlaintext_title(),
    message: m.deeplink_invitePlaintext_message(),
    buttons: [m.deeplink_inviteFailed_ok_button()],
    defaultId: 0,
  });
}

/**
 * Map a failure onto one user-facing sentence: transport failures route on
 * `InviteTransportError.transportCode`, host refusals on `error.data.code`,
 * the guest daemon's proof refusals on `IdentityProofError.proofCode`, and
 * the guest's own sign-in on `InviteFlowError.flowCode`.
 */
function describeInviteFailure(error: unknown): string {
  if (error instanceof PinMismatchError) return m.deeplink_inviteError_certMismatch();
  if (error instanceof InviteTransportError) return describeTransportFailure(error);
  if (error instanceof guestSessionsStore.GuestEncryptionUnavailableError) {
    return m.deeplink_inviteError_encryptionUnavailable();
  }
  if (error instanceof guestSessionsStore.GuestStoreCorruptError) {
    return m.deeplink_inviteError_storeCorrupt();
  }
  if (error instanceof InviteFlowError) return describeFlowFailure(error);
  if (error instanceof IdentityProofError) return describeProofFailure(error);
  const code = error instanceof InviteRpcError ? error.inviteCode : null;
  switch (code) {
    case 'invite-expired':
      return m.deeplink_inviteError_expired();
    case 'invite-revoked':
      return m.deeplink_inviteError_revoked();
    case 'invite-redeemed':
      return m.deeplink_inviteError_redeemed();
    case 'invite-pin-mismatch':
      return m.deeplink_inviteError_pinMismatch();
    case 'proof-invalid':
      return m.deeplink_inviteError_proofInvalid();
    case 'proof-expired':
      return m.deeplink_inviteError_proofExpired();
    case 'github-unreachable':
      return m.deeplink_inviteError_hostGithubUnreachable();
    case 'workspace-full':
      return m.deeplink_inviteError_workspaceFull();
    case 'owner-self-join':
      return m.deeplink_inviteError_ownerSelfJoin();
    default:
      return m.deeplink_inviteError_generic();
  }
}

/** One sentence per local flow code — how the guest's own sign-in step ended. */
function describeFlowFailure(error: InviteFlowError): string {
  switch (error.flowCode) {
    case 'verification-launch-failed':
      return m.deeplink_inviteError_launchFailed();
    case 'sign-in-denied':
      return m.deeplink_inviteError_denied();
    case 'sign-in-expired':
      return m.deeplink_inviteError_flowExpired();
    case 'sign-in-failed':
    case 'invalid-verification-uri':
      return m.deeplink_inviteError_signInFailed();
  }
}

/** One sentence per proof code — why the guest's own daemon could not publish the proof. */
function describeProofFailure(error: IdentityProofError): string {
  switch (error.proofCode) {
    case 'github-not-connected':
      return m.deeplink_inviteError_proofNotConnected();
    case 'github-scope-missing':
      return m.deeplink_inviteError_proofScopeMissing();
    case 'github-unreachable':
      return m.deeplink_inviteError_proofGithubUnreachable();
    case null:
      return m.deeplink_inviteError_proofFailed();
  }
}

/** One sentence per transport code — which of the distinct causes stopped the dial. */
function describeTransportFailure(error: InviteTransportError): string {
  switch (error.transportCode) {
    case 'tailcat-unavailable':
      return m.deeplink_inviteError_tailcatUnavailable();
    case 'tunnel-failed':
      return m.deeplink_inviteError_tunnelFailed();
    case 'host-unreachable':
      return m.deeplink_inviteError_hostUnreachable();
    case 'host-refused':
      return m.deeplink_inviteError_hostRefused();
    case 'connection-closed':
      return m.deeplink_inviteError_connectionClosed();
  }
}

async function showFailure(error: unknown): Promise<void> {
  try {
    await showDialog({
      type: 'error',
      title: m.deeplink_inviteFailed_title(),
      message: describeInviteFailure(error),
      buttons: [m.deeplink_inviteFailed_ok_button()],
      defaultId: 0,
    });
  } catch (dialogError) {
    logger.warn('Could not show invite failure dialog', describeErrorForLog(dialogError));
  }
}
