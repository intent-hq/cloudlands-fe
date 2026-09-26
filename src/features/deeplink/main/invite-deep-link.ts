/**
 * Workspace invitation acceptance. The host challenge fixes the required provider,
 * instance and stable account; collaboration-capable local daemons prepare that
 * identity through explicit account consent. Legacy local daemons can reuse a
 * suitable existing repository credential, but cannot start identity-only auth.
 * Proof creation and cleanup always use the guest's local connection. Only proof
 * references reach the invited host; account credentials never do. Returning
 * sessions and final redemption remain in the existing guest-session flow.
 */
import { app, dialog, type MessageBoxOptions } from 'electron';
import { randomUUID } from 'node:crypto';

import type {
  InviteConsentOutcome,
  InviteConsentShowPayload,
  InviteIdentityProvider,
  InviteSignInReason,
} from '$shared/ipc/invite-consent';
import type { InviteFailureReason, InviteNoticeShowPayload } from '$shared/ipc/invite-notice';
import { Logger } from '$shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { isTcAddress } from '$shared/tc-address';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { describeInviteFailureReason } from '$shared/utils/invite-failure-text';
import { parseInviteUri } from '$shared/utils/invite-uri';
import { showInviteConsent, type InviteConsentPrompt } from '../../../main/invite-consent';
import { showInviteNotice } from '../../../main/invite-notice';
import { showInviteProgress, type InviteProgressHandle } from '../../../main/invite-progress';
import { getMainWindow } from '../../../main/state';
import * as guestSessionsStore from '../../backend/main/guest-sessions-store';
import {
  getBackendClient,
  getConnectedDaemonProtocolVersion,
  captureLocalIdentityConnection,
  openBackendWindow,
} from '../../backend/main/backend.ipc';
import { PinMismatchError, normalizeFingerprint } from '../../backend/main/backend-connection';
import { protocolVersionAtLeast } from '../../backend/main/protocol-compat';
import {
  InviteRpcError,
  InviteTransportError,
  openInviteConnection,
  type InviteChallenge,
  type InviteConnection,
  type InviteInspection,
  type InviteProof,
} from '../../backend/main/invite-connection';
import type { JsonRpcClient } from '../../backend/main/json-rpc-client';
import { JsonRpcError } from '../../backend/main/json-rpc-errors';
import type { PrincipalIdentity } from '../../workspace-sharing/types';
import { prepareCollaborationIdentity } from '../../collaboration-auth/main/collaboration-auth.ipc';
import {
  CollaborationIdentityClient,
  type CollaborationAttempt,
  type PreparedCollaborationIdentity,
} from '../../collaboration-auth/main/collaboration-auth-flow';
import { identitiesEqual, isCollaborationIdentity } from '../../collaboration-auth/identity';

const logger = new Logger('InviteDeepLink');

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
 * Display labels of the notices, filled in as the flow learns them: the
 * dialed address once the connection is up, then the prompt labels once the
 * host has described the invite, then the forge instance a GitLab proof is
 * made on. Whatever is known at the time of a failure is what the notice
 * shows.
 */
type NoticeLabels = Partial<PromptLabels> & { identityHost?: string };

/** The forge account the guest's own daemon is signed in as. */
interface LocalIdentity extends InviteIdentityProvider {
  login: string;
  /** Absent only on the legacy login-only path. */
  externalUserId?: string;
  collaboration?: PreparedCollaborationIdentity;
}

const GITHUB_HOST = 'github.com';

/** Selection failures carry only a bounded, localized reason. */
class InviteIdentityError extends Error {
  constructor(
    readonly reason: 'pin-mismatch' | 'identity-unavailable',
    public accountProvider?: 'github' | 'gitlab',
  ) {
    // i18n-ignore (internal error, fixed text)
    super('invite identity unavailable');
    this.name = 'InviteIdentityError';
  }
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
 * codes describe the guest's local collaboration authentication result.
 */
type InviteFlowCode =
  | 'invalid-verification-uri'
  | 'verification-launch-failed'
  | 'sign-in-denied'
  | 'sign-in-expired'
  | 'sign-in-failed'
  | 'collaboration-upgrade-required';

class InviteFlowError extends Error {
  constructor(readonly flowCode: InviteFlowCode) {
    // i18n-ignore (internal error, fixed text)
    super('invite flow refused');
    this.name = 'InviteFlowError';
  }
}

/**
 * The guest daemon's documented `error.data.code` values for
 * `github.identityProof.create` / `.delete` (intentd #1967) and their
 * per-provider `sourceControl.identityProof.*` counterparts for GitLab, plus
 * `rate-limited` — the forge rate limiting the daemon's API calls (primary or
 * secondary limit, REST or GraphQL), which the account probes and the proof
 * calls of either provider report (intent-hq/intent#5627). Like the host's
 * invite codes, the closed set is the only daemon-authored text that leaves
 * {@link IdentityProofError}; anything else maps to `null`.
 */
const IDENTITY_PROOF_ERROR_CODES = [
  'github-not-connected',
  'github-scope-missing',
  'github-unreachable',
  'gitlab-not-connected',
  'gitlab-scope-missing',
  'gitlab-unreachable',
  'rate-limited',
] as const;

type IdentityProofErrorCode = (typeof IDENTITY_PROOF_ERROR_CODES)[number];

/**
 * A `github.identityProof.*` call on the guest's own daemon failed: the
 * daemon's bounded code when it sent one, else `null` (transport, a daemon
 * that is not running, an undocumented error). The message text is dropped.
 * `provider` is the forge the failing call addressed — the code set is shared
 * by both, and the provider-neutral `rate-limited` needs it to name the right
 * forge in the failure notice.
 */
class IdentityProofError extends Error {
  constructor(
    readonly proofCode: IdentityProofErrorCode | null,
    readonly provider: InviteIdentityProvider['provider'] = 'github',
  ) {
    // i18n-ignore (internal error, fixed text)
    super('identity proof failed');
    this.name = 'IdentityProofError';
  }

  /** Reduce a thrown value to its bounded code (an `IdentityProofError` passes through). */
  static from(
    error: unknown,
    provider: InviteIdentityProvider['provider'] = 'github',
  ): IdentityProofError {
    if (error instanceof IdentityProofError) return error;
    const code = error instanceof JsonRpcError ? error.code : null;
    return new IdentityProofError(
      typeof code === 'string' && (IDENTITY_PROOF_ERROR_CODES as readonly string[]).includes(code)
        ? (code as IdentityProofErrorCode)
        : null,
      provider,
    );
  }
}

/** The user pressed Cancel on the progress dialog while the flow was still connecting. */
class InviteCancelledError extends Error {
  constructor() {
    // i18n-ignore (internal error, fixed text)
    super('invite cancelled while connecting');
    this.name = 'InviteCancelledError';
  }
}

/**
 * The `connecting` progress dialog of one join: up from the moment the link
 * parses until the first consent prompt (or the failure notice) replaces it.
 * `wait` races a connecting-phase step against Cancel and rejects with
 * {@link InviteCancelledError} when the user cancels first; `onLateResult`
 * then disposes of the step's result should it still arrive.
 */
interface ConnectingProgress {
  wait<T>(step: Promise<T>, onLateResult?: (result: T) => void): Promise<T>;
  connected(hostLabel: string): void;
  dismiss(): void;
}

function showConnectingProgress(): ConnectingProgress {
  const handle = showInviteProgress({ requestId: randomUUID(), phase: 'connecting' });
  const cancelled: Promise<never> = handle.cancelled.then(() => {
    throw new InviteCancelledError();
  });
  cancelled.catch(() => {});
  return {
    async wait(step, onLateResult) {
      try {
        return await Promise.race([step, cancelled]);
      } catch (error) {
        if (error instanceof InviteCancelledError) {
          void step.then(onLateResult, () => {});
        }
        throw error;
      }
    },
    connected: (hostLabel) => handle.update('connecting', { hostLabel }),
    dismiss: () => handle.dismiss(),
  };
}

/**
 * The consent prompts of one join, in order. Showing the next prompt ends
 * the previous one as `superseded` (after the renderer already shows the new
 * request, so it never flickers closed), unless the flow already dismissed
 * it; `current()` is what the failure path dismisses. The first prompt also
 * ends the `connecting` progress dialog it replaces.
 */
interface ConsentPrompts {
  show(payload: InviteConsentShowPayload): InviteConsentPrompt;
  current(): InviteConsentPrompt | null;
}

function createConsentPrompts(connecting: ConnectingProgress): ConsentPrompts {
  let current: InviteConsentPrompt | null = null;
  return {
    show(payload) {
      connecting.dismiss();
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
 * rejects — failures are logged (scrubbed) and surfaced in a notice dialog.
 */
export async function handleInviteDeepLink(url: string): Promise<void> {
  if (inviteLinkInFlight) {
    logger.info('Ignoring invite link while another is being handled');
    return;
  }
  inviteLinkInFlight = true;
  let attemptActive = true;
  const attempt: CollaborationAttempt = {
    id: randomUUID(),
    metadataRevision: 0,
    current: () => attemptActive,
  };
  let connection: InviteConnection | null = null;
  let connecting: ConnectingProgress | null = null;
  let prompts: ConsentPrompts | null = null;
  // Display labels for the notices, filled in as the flow learns them.
  const labels: NoticeLabels = {};
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
    connecting = showConnectingProgress();
    prompts = createConsentPrompts(connecting);
    // A dial that completes after the user cancelled is closed on arrival.
    connection = await connecting.wait(
      openInviteConnection({ hosts, port, fingerprint, tcAddress }),
      (late) => late.close(),
    );
    labels.hostLabel = connection.host;
    connecting.connected(connection.host);
    const returning = await joinAsReturningGuest(connection, envelope, prompts, connecting, labels);
    if (returning.kind === 'handled') return;
    logger.info('No usable stored credential for this host; proving identity through a forge', {
      reason: returning.reason,
    });
    await joinWithIdentityProof(connection, envelope, prompts, connecting, labels, attempt);
  } catch (error) {
    connecting?.dismiss();
    if (error instanceof InviteCancelledError) {
      logger.info('User cancelled the invite while connecting');
      return;
    }
    logger.warn('Invite deep link handling failed', describeErrorForLog(error));
    // The handoff dismiss is a no-op once the modal was dismissed `joined`;
    // the failure notice still shows.
    await showFailure(
      {
        kind: 'failed',
        reason: classifyInviteFailure(error),
        ...labels,
        ...(error instanceof InviteIdentityError && error.accountProvider
          ? { accountProvider: error.accountProvider }
          : {}),
      },
      { consent: prompts?.current() ?? null, outcome: 'failed' },
    );
  } finally {
    connecting?.dismiss();
    connection?.close();
    attemptActive = false;
    inviteLinkInFlight = false;
  }
}

/** How one proof attempt ended; every kind but `joined` leaves nothing minted. */
type ProveOutcome =
  | { kind: 'joined' }
  | { kind: 'cancelled' }
  | { kind: 'sign-in-required'; reason: InviteSignInReason }
  | { kind: 'proof-refused'; code: ProofRefusalCode }
  | { kind: 'account-changed'; identity: LocalIdentity };

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
  connecting: ConnectingProgress,
  noticeLabels: NoticeLabels,
  attempt: CollaborationAttempt,
): Promise<void> {
  const { inviteId, secret } = envelope;
  const client = getBackendClient();
  let challenge = await connecting.wait(connection.challenge(inviteId, secret));
  const labels: PromptLabels = {
    hostLabel: hostLabelFor(connection, challenge),
    workspaceTitle: nonBlank(challenge.workspaceTitle) ?? m.workspace_links_untitled_label(),
  };
  Object.assign(noticeLabels, labels);

  let identity: LocalIdentity | null;
  if (captureLocalIdentityConnection().supported) {
    const prepared = await signInForCollaboration(labels, connecting, challenge, attempt);
    if (prepared.kind === 'cancelled') return;
    identity = prepared.identity;
  } else {
    identity = await connecting.wait(readInviteIdentity(client, challenge));
  }
  let signInReason: InviteSignInReason | null = identity === null ? 'not-connected' : null;
  let signedIn = false;
  let consented = false;
  let retried = false;
  let consent: InviteConsentPrompt | null = null;
  for (;;) {
    if (signInReason !== null) {
      if (signedIn) {
        throw new IdentityProofError(
          signInReason === 'scope-missing'
            ? identity?.provider === 'gitlab'
              ? 'gitlab-scope-missing'
              : 'github-scope-missing'
            : identity?.provider === 'gitlab'
              ? 'gitlab-not-connected'
              : 'github-not-connected',
          identity?.provider,
        );
      }
      const signIn = await signInForCollaboration(labels, connecting, challenge, attempt);
      if (signIn.kind === 'cancelled') return;
      signedIn = true;
      identity = signIn.identity;
      signInReason = null;
      // The account may differ from the one first read: consent names it anew.
      consented = false;
    }
    const current = identity as LocalIdentity;
    // A GitLab proof is read back on the instance; the failure notice names it.
    noticeLabels.identityHost = current.provider === 'gitlab' ? current.host : undefined;
    if (!consented) {
      consent = prompts.show({
        requestId: randomUUID(),
        mode: 'prove',
        login: current.login,
        identity: { provider: current.provider, host: current.host },
        ...labels,
      });
      const decision = await consent.decision;
      if (decision === 'cancel') {
        consent.dismiss('cancelled');
        logger.info('User cancelled the invite before proving identity');
        return;
      }
      // No renderer to show the modal (cold start / no ack): native box.
      if (decision === null && !(await showConfirmProve(current.login, labels.workspaceTitle))) {
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
      current,
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
        identity = outcome.identity;
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
        const refreshed = await connection.challenge(inviteId, secret);
        if (Object.hasOwn(challenge, 'pinIdentity') && !Object.hasOwn(refreshed, 'pinIdentity')) {
          throw new InviteIdentityError(
            challenge.pinIdentity ? 'pin-mismatch' : 'identity-unavailable',
            current.provider,
          );
        }
        challenge = refreshed;
        identity = await readInviteIdentity(client, challenge, current.collaboration);
        if (!sameIdentity(current, identity)) consented = false;
        signInReason = identity === null ? 'not-connected' : null;
        break;
    }
  }
}

/**
 * One proof attempt against the current challenge. `consent` is the prompt
 * in its waiting state (or `null` on a retry, when nothing is up): a Cancel
 * that lands before `invite.prove` is sent aborts the attempt — the proof is
 * deleted — while the prove answer is the point of no return. `identity` is
 * the account the user consented to: a proof the guest daemon creates under
 * any other account is deleted, unproven, and reported as `account-changed`
 * so the host never learns an account the user did not approve. The proof is
 * deleted best-effort on every path but `sign-in-required` (where none was
 * created).
 */
async function proveIdentity(
  connection: InviteConnection,
  client: JsonRpcClient,
  envelope: InviteEnvelope,
  challenge: InviteChallenge,
  labels: PromptLabels,
  identity: LocalIdentity,
  consent: InviteConsentPrompt | null,
): Promise<ProveOutcome> {
  let cancelled = false;
  void consent?.cancelledWhileWaiting.then(() => {
    cancelled = true;
  });
  const readCurrent = () =>
    consent === null
      ? readInviteIdentity(client, challenge, identity.collaboration)
      : Promise.race([
          readInviteIdentity(client, challenge, identity.collaboration),
          consent.cancelledWhileWaiting.then(() => 'cancelled' as const),
        ]);

  // The account may have changed while consent was open. Probe only the
  // required forge, before publishing anything, and bind consent to its ID.
  if (identity.collaboration || hasIdentityRequirement(challenge)) {
    const latest = await readCurrent();
    if (latest === 'cancelled' || cancelled) {
      consent?.dismiss('cancelled');
      return { kind: 'cancelled' };
    }
    if (latest === null) return { kind: 'sign-in-required', reason: 'not-connected' };
    if (!sameIdentity(identity, latest)) {
      consent?.dismiss('superseded');
      return { kind: 'account-changed', identity: latest };
    }
  }

  let proof: PublishedProof;
  try {
    proof = await createProof(client, identity, challenge.nonce, labels.hostLabel);
  } catch (error) {
    const refusal = IdentityProofError.from(error, identity.provider);
    if (
      refusal.proofCode === 'github-scope-missing' ||
      (identity.collaboration && refusal.proofCode === 'gitlab-scope-missing')
    ) {
      return { kind: 'sign-in-required', reason: 'scope-missing' };
    }
    if (
      refusal.proofCode === 'github-not-connected' ||
      (identity.collaboration && refusal.proofCode === 'gitlab-not-connected')
    ) {
      return { kind: 'sign-in-required', reason: 'not-connected' };
    }
    throw refusal;
  }
  if (cancelled) {
    void deleteProof(client, proof);
    consent?.dismiss('cancelled');
    logger.info('User cancelled the invite while the identity proof was being made');
    return { kind: 'cancelled' };
  }
  if (identity.collaboration || hasIdentityRequirement(challenge)) {
    try {
      // GitLab returns the actual snippet author's stable ID. The GitHub
      // alias has no ID field, so recheck GET /user as well as proof.login.
      if (
        proof.provider === 'gitlab' &&
        (proof.account?.provider !== identity.provider ||
          proof.account.host !== identity.host ||
          proof.account.externalUserId !== identity.externalUserId)
      )
        throw new InviteIdentityError(
          challenge.pinIdentity ? 'pin-mismatch' : 'identity-unavailable',
          identity.provider,
        );
      const latest = await readCurrent();
      if (latest === 'cancelled' || cancelled) {
        void deleteProof(client, proof);
        consent?.dismiss('cancelled');
        return { kind: 'cancelled' };
      }
      if (latest === null) throw new InviteIdentityError('identity-unavailable', identity.provider);
      if (!sameIdentity(identity, latest)) {
        void deleteProof(client, proof);
        consent?.dismiss('superseded');
        return { kind: 'account-changed', identity: latest };
      }
      if (proof.login !== identity.login) {
        throw new InviteIdentityError(
          challenge.pinIdentity ? 'pin-mismatch' : 'identity-unavailable',
          identity.provider,
        );
      }
    } catch (error) {
      void deleteProof(client, proof);
      throw error;
    }
  }
  if (proof.login !== identity.login) {
    void deleteProof(client, proof);
    consent?.dismiss('superseded');
    logger.info('Identity proof named a different forge account than consented; asking again', {
      provider: identity.provider,
    });
    return { kind: 'account-changed', identity: { ...identity, login: proof.login } };
  }

  let credential: Awaited<ReturnType<InviteConnection['prove']>>;
  try {
    credential = await connection.prove(
      envelope.inviteId,
      envelope.secret,
      proofParamsFor(proof, challenge.nonce),
    );
  } catch (error) {
    void deleteProof(client, proof);
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
  await storeCredentialAndOpen(
    connection,
    envelope,
    credential,
    challenge.workspaceTitle,
    labels,
    () => deleteProof(client, proof),
  );
  return { kind: 'joined' };
}

/**
 * The proof the guest's own daemon published, by forge: a GitHub gist
 * (`github.identityProof.create`, the alias every daemon serves) or a GitLab
 * snippet on `host` (`sourceControl.identityProof.create`). `login` is the
 * account the daemon actually published under.
 */
type PublishedProof = { collaboration?: PreparedCollaborationIdentity } & (
  | { provider: 'github'; gistId: string; login: string }
  | {
      provider: 'gitlab';
      host: string;
      proofId: string;
      login: string;
      account: PrincipalIdentity | null;
    }
);

async function createProof(
  client: JsonRpcClient,
  identity: LocalIdentity,
  nonce: string,
  hostLabel: string,
): Promise<PublishedProof> {
  if (identity.collaboration) {
    const prepared = identity.collaboration;
    const proof = await new CollaborationIdentityClient(prepared.local).createProof(
      prepared,
      nonce,
      hostLabel,
    );
    if (
      !isCollaborationIdentity(proof) ||
      !identitiesEqual(proof, prepared.identity) ||
      typeof proof.proofId !== 'string' ||
      !proof.proofId ||
      typeof proof.login !== 'string' ||
      !proof.login
    ) {
      if (typeof proof.proofId === 'string')
        await new CollaborationIdentityClient(prepared.local)
          .deleteProof(prepared.identity, proof.proofId)
          .catch(() => {});
      throw new InviteIdentityError('pin-mismatch', identity.provider);
    }
    return identity.provider === 'github'
      ? { provider: 'github', gistId: proof.proofId, login: proof.login, collaboration: prepared }
      : {
          provider: 'gitlab',
          host: proof.host,
          proofId: proof.proofId,
          login: proof.login,
          account: proof,
          collaboration: prepared,
        };
  }
  if (identity.provider === 'github') {
    const result = await client.request<{ gistId: string; login: string }>(
      'github.identityProof.create',
      { nonce, hostLabel },
    );
    return { provider: 'github', gistId: result.gistId, login: result.login };
  }
  const result = await client.request<{
    proofId: string;
    login: string;
    provider: string;
    host: string;
    externalUserId: string | null;
  }>('sourceControl.identityProof.create', {
    provider: 'gitlab',
    host: identity.host,
    nonce,
    hostLabel,
  });
  return {
    provider: 'gitlab',
    host: identity.host,
    proofId: result.proofId,
    login: result.login,
    account: validIdentity(result) ? result : null,
  };
}

/** The `invite.prove` proof fields: `gistId` for GitHub (every host reads it), the triple for GitLab. */
function proofParamsFor(proof: PublishedProof, nonce: string): InviteProof {
  if (proof.provider === 'github') return { nonce, gistId: proof.gistId, login: proof.login };
  return {
    nonce,
    provider: 'gitlab',
    host: proof.host,
    proofId: proof.proofId,
    login: proof.login,
  };
}

/** The continuation stops before invitation redemption and never performs repository setup. */
async function signInForCollaboration(
  labels: PromptLabels,
  connecting: ConnectingProgress,
  challenge: InviteChallenge,
  attempt: CollaborationAttempt,
): Promise<{ kind: 'signed-in'; identity: LocalIdentity } | { kind: 'cancelled' }> {
  if (!captureLocalIdentityConnection().supported)
    throw new InviteFlowError('collaboration-upgrade-required');
  connecting.dismiss();
  const result = await prepareCollaborationIdentity(
    {
      scope: 'workspace',
      ...(Object.hasOwn(challenge, 'pinIdentity') ? { pinIdentity: challenge.pinIdentity } : {}),
      ...labels,
    },
    { attempt },
  );
  if (result.kind === 'cancelled') return result;
  if (result.kind === 'error') throw new InviteFlowError('sign-in-failed');
  const prepared = result.prepared;
  if (
    prepared.attempt.id !== attempt.id ||
    prepared.attempt.metadataRevision !== attempt.metadataRevision ||
    !attempt.current() ||
    !prepared.attempt.current() ||
    !prepared.local.current() ||
    !prepared.local.supported ||
    !prepared.allowed()
  )
    return { kind: 'cancelled' };
  const pin = challenge.pinIdentity;
  if (pin != null && (!isCollaborationIdentity(pin) || !identitiesEqual(pin, prepared.identity)))
    throw new InviteIdentityError('pin-mismatch', prepared.identity.provider);
  return {
    kind: 'signed-in',
    identity: {
      ...result.prepared.identity,
      login: result.prepared.login,
      collaboration: result.prepared,
    },
  };
}

/**
 * The GitHub login the guest's own daemon is signed in as, or `null` when it
 * is not. A `rate-limited` refusal is neither: the account may well be signed
 * in, and a sign-in prompt would not help — it throws so the join fails with
 * that reason instead. Any other error reads as not signed in.
 */
async function readLocalLogin(client: JsonRpcClient): Promise<string | null> {
  try {
    const result = await client.request<{ user?: { login?: unknown } | null }>('github.getUser');
    return nonBlank(result?.user?.login) ?? null;
  } catch (error) {
    const refusal = IdentityProofError.from(error);
    if (refusal.proofCode === 'rate-limited') throw refusal;
    return null;
  }
}

/** The `sourceControl.authStatus` fields the GitLab identity read uses (PROTOCOL §5.27). */
interface ForgeAuthStatusResult {
  provider?: unknown;
  isConfigured?: boolean;
  host?: unknown;
  user?: { id?: unknown; login?: unknown } | null;
}

/**
 * First protocol version (major, minor) whose daemon serves the identity
 * seam: `sourceControl.identityProof.*` and the `provider` / `host` /
 * `proofId` params of `invite.prove` a GitLab proof needs. The GUEST's own
 * daemon must serve it — the proof is made there — so the probe is gated on
 * the local sidecar's hello, never on the host's.
 */
const IDENTITY_SEAM_MIN_PROTOCOL = { major: 10, minor: 8 } as const;

function identitySeamSupported(): boolean {
  return protocolVersionAtLeast(
    getConnectedDaemonProtocolVersion(LOCAL_CONNECTION_ID),
    IDENTITY_SEAM_MIN_PROTOCOL.major,
    IDENTITY_SEAM_MIN_PROTOCOL.minor,
  );
}

/** Validate the daemon's canonical authority, never repair a malformed wire identity. */
function validIdentity(value: unknown): value is PrincipalIdentity {
  if (!value || typeof value !== 'object') return false;
  const { provider, host, externalUserId } = value as Partial<PrincipalIdentity>;
  if (provider !== 'github' && provider !== 'gitlab') return false;
  if (
    typeof host !== 'string' ||
    typeof externalUserId !== 'string' ||
    !externalUserId ||
    externalUserId.trim() !== externalUserId
  )
    return false;
  if (provider === 'github') return host === GITHUB_HOST;
  try {
    const url = new URL(`https://${host}`);
    return (
      url.host === host &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function sameIdentity(a: LocalIdentity, b: LocalIdentity | null): boolean {
  return (
    b !== null &&
    a.provider === b.provider &&
    a.host === b.host &&
    a.externalUserId === b.externalUserId &&
    a.login === b.login
  );
}

/** Old hosts omit the field; old sidecars cannot select an unpinned neutral identity. */
function hasIdentityRequirement(inspection: InviteInspection): boolean {
  return (
    Object.hasOwn(inspection, 'pinIdentity') &&
    (inspection.pinIdentity !== null || identitySeamSupported())
  );
}

/**
 * Explicit pins override the local choice. Explicit null follows principal.me
 * (the Settings identity), without asking an unrelated forge. Omission keeps
 * the legacy GitHub-first flow; null on a pre-seam sidecar does too. A pin is
 * always enforced, even on an old sidecar, and is never treated as unpinned.
 */
async function readInviteIdentity(
  client: JsonRpcClient,
  inspection: InviteInspection,
  prepared?: PreparedCollaborationIdentity,
): Promise<LocalIdentity | null> {
  if (prepared) {
    const pin = inspection.pinIdentity;
    if (pin != null && (!isCollaborationIdentity(pin) || !identitiesEqual(pin, prepared.identity)))
      throw new InviteIdentityError('pin-mismatch', prepared.identity.provider);
    if (!prepared.allowed() || !prepared.attempt.current())
      throw new InviteIdentityError('identity-unavailable', prepared.identity.provider);
    const { user } = await new CollaborationIdentityClient(prepared.local).user(prepared.identity);
    if (!prepared.allowed() || !prepared.attempt.current())
      throw new InviteIdentityError('identity-unavailable', prepared.identity.provider);
    if (!user) return null;
    if (user.id !== prepared.identity.externalUserId || user.login !== prepared.login)
      throw new InviteIdentityError('identity-unavailable', prepared.identity.provider);
    return { ...prepared.identity, login: user.login, collaboration: prepared };
  }
  if (!hasIdentityRequirement(inspection)) return readLocalIdentity(client);
  const pin = inspection.pinIdentity;
  const failure = new InviteIdentityError(pin === null ? 'identity-unavailable' : 'pin-mismatch');
  let required: PrincipalIdentity;
  if (pin !== null) {
    if (!validIdentity(pin)) throw failure;
    required = pin;
  } else {
    const principal = await client.request<{ identity?: unknown }>('principal.me', {});
    if (principal?.identity == null) return null;
    if (!validIdentity(principal.identity)) throw failure;
    required = principal.identity;
  }
  if (required.provider === 'github') {
    failure.accountProvider = 'github';
    let result: { user?: { id?: unknown; login?: unknown } | null };
    try {
      result = await client.request('github.getUser');
    } catch (error) {
      const refusal = IdentityProofError.from(error);
      if (refusal.proofCode === 'rate-limited') throw refusal;
      throw failure;
    }
    const user = result?.user;
    if (user == null) return null;
    const login = nonBlank(user.login);
    if (
      !login ||
      typeof user.id !== 'number' ||
      !Number.isSafeInteger(user.id) ||
      String(user.id) !== required.externalUserId
    )
      throw failure;
    return { ...required, login };
  }
  if (!identitySeamSupported()) throw failure;
  failure.accountProvider = 'gitlab';
  let status: ForgeAuthStatusResult;
  try {
    status = await client.request('sourceControl.authStatus', {
      provider: required.provider,
      host: required.host,
    });
  } catch (error) {
    const refusal = IdentityProofError.from(error, 'gitlab');
    if (refusal.proofCode === 'rate-limited') throw refusal;
    throw failure;
  }
  const login = nonBlank(status?.user?.login);
  if (
    !login ||
    status?.isConfigured !== true ||
    status.provider !== required.provider ||
    status.host !== required.host ||
    status.user?.id !== required.externalUserId
  )
    throw failure;
  return { ...required, login };
}

/**
 * The forge account the guest's own daemon is signed in as: GitHub when it
 * has a GitHub connection, else GitLab (the instance the daemon's connection
 * targets), else `null`. The GitLab probe is only made against a local daemon
 * that serves the identity seam: an older one cannot publish a snippet proof,
 * so a GitLab-only guest on it reads as "not connected" and is sent to the
 * GitHub sign-in. A `rate-limited` refusal from either probe is neither
 * signed in nor not: it throws so the join fails with that reason instead of
 * a connect prompt that cannot help.
 */
async function readLocalIdentity(client: JsonRpcClient): Promise<LocalIdentity | null> {
  const githubLogin = await readLocalLogin(client);
  if (githubLogin !== null) return { provider: 'github', host: GITHUB_HOST, login: githubLogin };
  if (!identitySeamSupported()) return null;
  try {
    const result = await client.request<ForgeAuthStatusResult>('sourceControl.authStatus', {
      provider: 'gitlab',
    });
    const host = nonBlank(result?.host);
    const login = nonBlank(result?.user?.login);
    if (result?.isConfigured !== true || host === undefined || login === undefined) return null;
    return { provider: 'gitlab', host, login };
  } catch (error) {
    const refusal = IdentityProofError.from(error, 'gitlab');
    if (refusal.proofCode === 'rate-limited') throw refusal;
    return null;
  }
}

/**
 * Remove the published proof once the host has read it (or the attempt
 * ended). Best effort: a failure is logged by bounded code and never fails
 * the join.
 */
async function deleteProof(client: JsonRpcClient, proof: PublishedProof): Promise<void> {
  try {
    if (proof.collaboration) {
      await new CollaborationIdentityClient(proof.collaboration.local).deleteProof(
        proof.collaboration.identity,
        proof.provider === 'github' ? proof.gistId : proof.proofId,
      );
    } else if (proof.provider === 'github') {
      await client.request('github.identityProof.delete', { gistId: proof.gistId });
    } else {
      await client.request('sourceControl.identityProof.delete', {
        provider: 'gitlab',
        host: proof.host,
        proofId: proof.proofId,
      });
    }
  } catch (error) {
    logger.warn('Could not delete the identity proof', {
      provider: proof.provider,
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
  connecting: ConnectingProgress,
  noticeLabels: NoticeLabels,
): Promise<ReturningOutcome> {
  const { hosts, port, fingerprint, inviteId, secret } = envelope;
  // The winning candidate (a direct host, or the tc address standing in as
  // the host) is what the store keyed a tunnel-only session on.
  const session = await connecting.wait(
    guestSessionsStore.findMatching({
      hosts: [...new Set([connection.host, ...hosts])],
      port,
      fingerprint,
    }),
  );
  if (!session) return { kind: 'fallback', reason: 'no-session' };
  // Fail closed: the store's host:port fallback can match a record pinned to
  // a different cert at the same address. Only a session pinned to the exact
  // daemon this link is pinned to may have its credential reused.
  if (normalizeFingerprint(session.fingerprint) !== normalizeFingerprint(fingerprint)) {
    return { kind: 'fallback', reason: 'fingerprint-mismatch' };
  }
  let token: string | null;
  try {
    token = await connecting.wait(guestSessionsStore.getDecryptedToken(session.id));
  } catch (error) {
    if (error instanceof InviteCancelledError) throw error;
    // Keyring changed: the ciphertext is unreadable. A fresh proof re-mints
    // the credential; the store's upsert then replaces it.
    return { kind: 'fallback', reason: 'token-unavailable' };
  }
  if (token === null) return { kind: 'fallback', reason: 'no-token' };

  const inspection = await connecting.wait(connection.inspect(inviteId, secret));
  if (session.workspaces.some((w) => w.id === inspection.workspaceId)) {
    logger.info('Already a member of the invited workspace on this host; opening the window', {
      id: session.id,
      workspaceId: inspection.workspaceId,
      via: connection.via,
    });
    connecting.dismiss();
    await openBackendWindow(session.id);
    return { kind: 'handled' };
  }

  const hostLabel = hostLabelFor(connection, inspection);
  const workspaceTitle = nonBlank(inspection.workspaceTitle) ?? m.workspace_links_untitled_label();
  Object.assign(noticeLabels, { hostLabel, workspaceTitle });
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
  await storeCredentialAndOpen(connection, envelope, credential, inspection.workspaceTitle, {
    hostLabel,
    workspaceTitle,
  });
  return { kind: 'handled' };
}

/**
 * Persist the minted credential as a GUEST session (the store upserts by
 * daemon identity: a returning guest's record keeps its id, takes the fresh
 * token, and gains the workspace) and open the daemon's window, under the
 * `opening` progress dialog. A store failure here surfaces as a failure,
 * never as a cancellation; a Cancel on the dialog closes it at once and only
 * skips opening the window — the credential is stored, the membership stands,
 * and a window whose open was already requested still appears. `labels` are
 * the display labels the dialog and the plaintext notice show; `afterStore`
 * runs once the write settled either way (the proof gist's cleanup: it must
 * not delay or fail the join, and the gist outliving a failed write by a
 * moment is harmless — the nonce is spent).
 */
async function storeCredentialAndOpen(
  connection: InviteConnection,
  envelope: Pick<InviteEnvelope, 'hosts' | 'port' | 'fingerprint' | 'tcAddress'>,
  credential: { token: string; principalId: string; login: string; workspaceId: string },
  workspaceTitle: string,
  labels: PromptLabels,
  afterStore?: () => Promise<void>,
): Promise<void> {
  const opening: InviteProgressHandle = showInviteProgress({
    requestId: randomUUID(),
    phase: 'opening',
    ...labels,
  });
  let cancelled = false;
  void opening.cancelled.then(() => {
    cancelled = true;
    opening.dismiss();
  });
  try {
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
      // user learns the credential is not protected by OS encryption —
      // acknowledged before the window opens. The consent modal is already
      // dismissed `joined`, so there is no modal to hand off from.
      await showPlaintextWarning({ kind: 'plaintext', ...labels });
    }
    if (cancelled) {
      logger.info('User closed the join progress dialog; window not opened', { id: record.id });
      return;
    }
    await openBackendWindow(record.id);
  } finally {
    opening.dismiss();
  }
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
  if (error instanceof InviteIdentityError) return { kind: 'identity', reason: error.reason };
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

/** The consent modal to close once the notice is on screen, with its outcome. */
interface ConsentHandoff {
  consent: InviteConsentPrompt | null;
  outcome: InviteConsentOutcome;
}

/**
 * Show a notice in the renderer, falling back to the given native box when the
 * renderer path is unavailable. With a handoff, the notice is sent BEFORE the
 * consent modal is dismissed so the renderer swaps one modal for the other
 * without a frame of bare window in between; on the fallback path the dismiss
 * still precedes the native box. Resolves once the user has acknowledged
 * either surface.
 */
async function showNotice(
  payload: Omit<InviteNoticeShowPayload, 'requestId'>,
  handoff: ConsentHandoff | null,
  nativeOptions: MessageBoxOptions,
): Promise<void> {
  const acknowledged = showInviteNotice({ requestId: randomUUID(), ...payload });
  handoff?.consent?.dismiss(handoff.outcome);
  if (await acknowledged) return;
  await showDialog(nativeOptions);
}

/**
 * Warn that the credential was stored in plaintext because OS encryption is
 * unavailable on this machine (flagged fallback); the join itself stands. The
 * consent modal was already dismissed `joined` at the grant, so no handoff.
 */
async function showPlaintextWarning(
  payload: Omit<InviteNoticeShowPayload, 'requestId'>,
): Promise<void> {
  await showNotice(payload, null, {
    type: 'warning',
    title: m.deeplink_invitePlaintext_title(),
    message: m.deeplink_invitePlaintext_message(),
    buttons: [m.deeplink_inviteFailed_ok_button()],
    defaultId: 0,
  });
}

/**
 * Map a failure onto its bounded reason: transport failures route on
 * `InviteTransportError.transportCode`, host refusals on `error.data.code`,
 * the guest daemon's proof refusals on `IdentityProofError.proofCode`, and
 * the guest's own sign-in on `InviteFlowError.flowCode`. The reason is what
 * crosses to the renderer — never the error's text.
 */
function classifyInviteFailure(error: unknown): InviteFailureReason {
  if (error instanceof InviteIdentityError) return error.reason;
  if (error instanceof PinMismatchError) return 'cert-mismatch';
  if (error instanceof InviteTransportError) return error.transportCode;
  if (error instanceof guestSessionsStore.GuestEncryptionUnavailableError) {
    return 'encryption-unavailable';
  }
  if (error instanceof guestSessionsStore.GuestStoreCorruptError) return 'store-corrupt';
  if (error instanceof InviteFlowError) return classifyFlowFailure(error);
  if (error instanceof IdentityProofError) return classifyProofFailure(error);
  const code = error instanceof InviteRpcError ? error.inviteCode : null;
  switch (code) {
    case 'invite-expired':
      return 'expired';
    case 'invite-revoked':
      return 'revoked';
    case 'invite-redeemed':
      return 'redeemed';
    case 'invite-pin-mismatch':
      return 'pin-mismatch';
    case 'proof-invalid':
      return 'proof-invalid';
    case 'proof-expired':
      return 'proof-expired';
    case 'github-unreachable':
      return 'host-github-unreachable';
    case 'identity-unverifiable':
      return 'identity-unverifiable';
    case 'workspace-full':
      return 'workspace-full';
    case 'owner-self-join':
      return 'owner-self-join';
    default:
      return 'generic';
  }
}

/** One reason per local flow code — how the guest's own sign-in step ended. */
function classifyFlowFailure(error: InviteFlowError): InviteFailureReason {
  switch (error.flowCode) {
    case 'collaboration-upgrade-required':
      return 'collaboration-upgrade-required';
    case 'verification-launch-failed':
      return 'launch-failed';
    case 'sign-in-denied':
      return 'denied';
    case 'sign-in-expired':
      return 'flow-expired';
    case 'sign-in-failed':
    case 'invalid-verification-uri':
      return 'sign-in-failed';
  }
}

/** One reason per proof code — why the guest's own daemon could not publish the proof. */
function classifyProofFailure(error: IdentityProofError): InviteFailureReason {
  switch (error.proofCode) {
    case 'github-not-connected':
      return 'proof-not-connected';
    case 'github-scope-missing':
      return 'proof-scope-missing';
    case 'github-unreachable':
      return 'proof-github-unreachable';
    case 'gitlab-not-connected':
      return 'proof-gitlab-not-connected';
    case 'gitlab-scope-missing':
      return 'proof-gitlab-scope-missing';
    case 'gitlab-unreachable':
      return 'proof-gitlab-unreachable';
    case 'rate-limited':
      return error.provider === 'gitlab' ? 'gitlab-rate-limited' : 'github-rate-limited';
    case null:
      return 'proof-failed';
  }
}

async function showFailure(
  payload: Omit<InviteNoticeShowPayload, 'requestId'> & { reason: InviteFailureReason },
  handoff: ConsentHandoff,
): Promise<void> {
  try {
    await showNotice(payload, handoff, {
      type: 'error',
      title: m.deeplink_inviteFailed_title(),
      message: describeInviteFailureReason(payload.reason, { identityHost: payload.identityHost }),
      buttons: [m.deeplink_inviteFailed_ok_button()],
      defaultId: 0,
    });
  } catch (dialogError) {
    handoff.consent?.dismiss(handoff.outcome);
    logger.warn('Could not show invite failure dialog', describeErrorForLog(dialogError));
  }
}
