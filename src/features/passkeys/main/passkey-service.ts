import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent, Session, WebContents, WebFrameMain } from 'electron';
import { z } from 'zod';
import { Logger } from '../../../shared/logger';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import type {
  PasskeyCeremonyKind,
  PasskeyCredentialDescriptor,
  PasskeyDialogView,
  PasskeyErrorReason,
  PasskeyPageCreateOptions,
  PasskeyPageErrorName,
  PasskeyPageGetOptions,
  PasskeyPageResult,
  PasskeyProgress,
  PasskeyTransport,
} from '../../../shared/ipc/passkeys';
import { checkFrameOrigin, isValidRpIdForHost } from './passkey-origin';
import { SidecarError, type PasskeySidecar, type SidecarEvent } from './passkey-sidecar';
import {
  assertedCredential,
  ceremonyTimeoutMs,
  clientDataMatches,
  createdCredential,
  createParams,
  dialogErrorReason,
  getParams,
  pageErrorName,
  type SidecarCreateResult,
  type SidecarGetResult,
} from './passkey-wire';

const logger = new Logger('Passkeys');
const CHANNELS = IPC_CHANNELS.PASSKEYS;

const base64url = z
  .string()
  .regex(/^[A-Za-z0-9_-]*$/)
  .max(16_384);
const descriptor: z.ZodType<PasskeyCredentialDescriptor> = z.object({
  id: base64url,
  transports: z.array(z.string().max(32)).max(8).optional(),
});
const optionalText = z.string().max(256).optional();

const CreateRequestSchema = z.object({
  requestId: z.string().min(1).max(64),
  publicKey: z.object({
    challenge: base64url.min(1),
    rp: z.object({ id: optionalText, name: z.string().max(256) }),
    user: z.object({
      id: base64url.min(1),
      name: z.string().max(256),
      displayName: z.string().max(256),
    }),
    pubKeyCredParams: z.array(z.object({ type: z.string(), alg: z.number().int() })).max(32),
    excludeCredentials: z.array(descriptor).max(256).optional(),
    authenticatorSelection: z
      .object({
        residentKey: optionalText,
        requireResidentKey: z.boolean().optional(),
        userVerification: optionalText,
        authenticatorAttachment: optionalText,
      })
      .optional(),
    attestation: optionalText,
    extensions: z.object({ credProps: z.boolean().optional() }).optional(),
    timeout: z.number().optional(),
  }),
});

const GetRequestSchema = z.object({
  requestId: z.string().min(1).max(64),
  publicKey: z.object({
    challenge: base64url.min(1),
    rpId: optionalText,
    allowCredentials: z.array(descriptor).max(256).optional(),
    userVerification: optionalText,
    timeout: z.number().optional(),
  }),
});

const CancelRequestSchema = z.object({ requestId: z.string().min(1).max(64) });

const DialogResponseSchema = z.discriminatedUnion('action', [
  z.object({
    ceremonyId: z.string(),
    action: z.literal('transport'),
    transport: z.enum(['hybrid', 'usb']),
  }),
  z.object({ ceremonyId: z.string(), action: z.literal('pin'), pin: z.string().min(1).max(256) }),
  z.object({ ceremonyId: z.string(), action: z.literal('choose'), index: z.number().int().min(0) }),
  z.object({ ceremonyId: z.string(), action: z.literal('cancel') }),
]);

const PHONE_PROGRESS = new Set<PasskeyProgress>([
  'waiting-for-phone',
  'connecting',
  'waiting-for-approval',
  'touch-key',
  'processing',
]);

interface Ceremony {
  id: string;
  kind: PasskeyCeremonyKind;
  guest: WebContents;
  host: WebContents;
  /** The frame (document) that started the ceremony. */
  frame: WebFrameMain;
  requestId: string;
  origin: string;
  rpId: string;
  options: PasskeyPageCreateOptions | PasskeyPageGetOptions;
  timeoutMs: number;
  bluetooth: 'on' | 'off' | 'missing';
  qr: string | null;
  running: boolean;
  settled: boolean;
  /** The dialog was shown; it can outlive the page request to show an error. */
  shown: boolean;
  closed: boolean;
  resolve: (result: PasskeyPageResult) => void;
  dispose: () => void;
}

function failure(name: PasskeyPageErrorName, message: string): PasskeyPageResult {
  return { ok: false, name, message };
}

function sameOriginWithAncestors(frame: WebFrameMain): boolean {
  for (let parent = frame.parent; parent; parent = parent.parent) {
    if (parent.origin !== frame.origin) return false;
  }
  return true;
}

/** How often main checks that the initiating frame still exists (iframes have no removal event). */
const FRAME_CHECK_MS = 500;

/**
 * Runs WebAuthn ceremonies for browser-panel webviews: one at a time per
 * webview, with the Intent dialog in the window that hosts the webview.
 */
export class PasskeyService {
  private readonly byId = new Map<string, Ceremony>();
  private readonly byGuest = new Map<number, Ceremony>();

  constructor(
    private readonly sidecar: PasskeySidecar,
    private readonly browserSession: () => Session,
  ) {}

  async handlePage(
    event: IpcMainInvokeEvent,
    kind: PasskeyCeremonyKind,
    payload: unknown,
  ): Promise<PasskeyPageResult> {
    const parsed =
      kind === 'create'
        ? CreateRequestSchema.safeParse(payload)
        : GetRequestSchema.safeParse(payload);
    if (!parsed.success) return failure('TypeError', 'Invalid passkey options.');
    const { requestId, publicKey } = parsed.data;

    const guest = event.sender;
    const host = guest.hostWebContents;
    if (guest.getType() !== 'webview' || guest.session !== this.browserSession() || !host) {
      return failure('NotAllowedError', 'Passkeys are available only in the browser panel.');
    }
    const frame = event.senderFrame;
    if (!frame || frame.isDestroyed()) {
      return failure('NotAllowedError', 'The document is not active.');
    }
    const originCheck = checkFrameOrigin(frame.origin, sameOriginWithAncestors(frame));
    if (!originCheck.ok) return failure(originCheck.name, originCheck.message);

    const requestedRpId =
      kind === 'create'
        ? (publicKey as PasskeyPageCreateOptions).rp.id
        : (publicKey as PasskeyPageGetOptions).rpId;
    const rpId = (requestedRpId ?? originCheck.host).toLowerCase();
    if (!isValidRpIdForHost(rpId, originCheck.host)) {
      return failure('SecurityError', 'The RP ID is not valid for this origin.');
    }
    if (this.byGuest.has(guest.id)) {
      return failure('NotAllowedError', 'A passkey request is already in progress.');
    }

    return new Promise<PasskeyPageResult>((resolve) => {
      const ceremony: Ceremony = {
        id: randomUUID(),
        kind,
        guest,
        host,
        frame,
        requestId,
        origin: originCheck.origin,
        rpId,
        options: publicKey,
        timeoutMs: ceremonyTimeoutMs(publicKey.timeout),
        bluetooth: 'missing',
        qr: null,
        running: false,
        settled: false,
        shown: false,
        closed: false,
        resolve,
        dispose: () => {},
      };
      // Track the document before the helper starts, so an abort, navigation
      // or removal while it starts still ends this ceremony.
      this.track(ceremony);
      logger.info('Passkey ceremony started', { ceremonyId: ceremony.id, kind, rpId });
      this.sidecar.start().then(
        (hello) => {
          if (ceremony.settled) return;
          ceremony.bluetooth = hello.bluetooth;
          this.show(ceremony, {
            step: 'choose-transport',
            hybrid:
              hello.bluetooth === 'on' && hello.transports.hybrid
                ? 'available'
                : hello.bluetooth === 'missing'
                  ? 'bluetooth-missing'
                  : 'bluetooth-off',
          });
        },
        (error: unknown) => {
          logger.warn('Passkey helper unavailable', { error: (error as Error).message });
          this.finish(ceremony, failure('NotAllowedError', 'Passkeys are not available.'), null);
        },
      );
    });
  }

  handlePageCancel(event: IpcMainInvokeEvent, payload: unknown): void {
    const parsed = CancelRequestSchema.safeParse(payload);
    if (!parsed.success) return;
    const ceremony = this.byGuest.get(event.sender.id);
    if (!ceremony || ceremony.requestId !== parsed.data.requestId) return;
    this.abort(ceremony, 'AbortError', 'The operation was aborted.');
  }

  async handleDialog(event: IpcMainInvokeEvent, payload: unknown): Promise<void> {
    const parsed = DialogResponseSchema.safeParse(payload);
    if (!parsed.success) return;
    const response = parsed.data;
    const ceremony = this.byId.get(response.ceremonyId);
    if (!ceremony || ceremony.host !== event.sender) return;

    if (response.action === 'cancel') {
      if (ceremony.settled) this.close(ceremony);
      else this.abort(ceremony, 'NotAllowedError', 'The user cancelled the request.');
      return;
    }
    if (ceremony.settled) return;
    try {
      if (response.action === 'transport') {
        if (ceremony.running) return;
        this.begin(ceremony, response.transport);
      } else if (response.action === 'pin') {
        this.show(ceremony, { step: 'progress', transport: 'usb', progress: 'processing' });
        await this.sidecar.request('pin', { ceremony: ceremony.id, pin: response.pin });
      } else {
        this.show(ceremony, { step: 'progress', transport: 'usb', progress: 'processing' });
        await this.sidecar.request('choose', { ceremony: ceremony.id, index: response.index });
      }
    } catch (error) {
      this.fail(ceremony, error);
    }
  }

  dispose(): void {
    for (const ceremony of [...this.byId.values()]) {
      this.abort(ceremony, 'AbortError', 'The operation was aborted.');
    }
    this.sidecar.dispose();
  }

  private track(ceremony: Ceremony): void {
    this.byId.set(ceremony.id, ceremony);
    this.byGuest.set(ceremony.guest.id, ceremony);
    // A new document in the initiating frame or any ancestor ends the ceremony.
    const lineage = new Set<number>();
    for (let frame: WebFrameMain | null = ceremony.frame; frame; frame = frame.parent) {
      lineage.add(frame.frameTreeNodeId);
    }
    const onNavigate = (details: {
      isMainFrame: boolean;
      isSameDocument: boolean;
      frame: WebFrameMain | null;
    }) => {
      if (details.isSameDocument) return;
      if (details.isMainFrame || (details.frame && lineage.has(details.frame.frameTreeNodeId))) {
        this.abort(ceremony, 'AbortError', 'The document navigated away.');
      }
    };
    const onGone = () => this.abort(ceremony, 'AbortError', 'The document was closed.');
    const timer = setTimeout(() => this.timeout(ceremony), ceremony.timeoutMs);
    const frameCheck = setInterval(() => {
      if (ceremony.frame.isDestroyed() || ceremony.frame.detached) {
        this.abort(ceremony, 'AbortError', 'The document was removed.');
      }
    }, FRAME_CHECK_MS);
    ceremony.guest.on('did-start-navigation', onNavigate);
    ceremony.guest.once('destroyed', onGone);
    ceremony.host.once('destroyed', onGone);
    ceremony.dispose = () => {
      clearTimeout(timer);
      clearInterval(frameCheck);
      if (!ceremony.guest.isDestroyed()) {
        ceremony.guest.off('did-start-navigation', onNavigate);
        ceremony.guest.off('destroyed', onGone);
      }
      if (!ceremony.host.isDestroyed()) ceremony.host.off('destroyed', onGone);
    };
  }

  private begin(ceremony: Ceremony, transport: PasskeyTransport): void {
    if (transport === 'hybrid' && ceremony.bluetooth !== 'on') {
      this.finish(
        ceremony,
        failure('NotAllowedError', 'Bluetooth is not available.'),
        ceremony.bluetooth === 'missing' ? 'bluetooth-missing' : 'bluetooth-off',
      );
      return;
    }
    ceremony.running = true;
    this.show(ceremony, { step: 'progress', transport, progress: 'starting' });
    const params =
      ceremony.kind === 'create'
        ? createParams(
            transport,
            ceremony.origin,
            ceremony.rpId,
            ceremony.options as PasskeyPageCreateOptions,
            ceremony.timeoutMs,
          )
        : getParams(
            transport,
            ceremony.origin,
            ceremony.rpId,
            ceremony.options as PasskeyPageGetOptions,
            ceremony.timeoutMs,
          );
    this.sidecar
      .request<SidecarCreateResult | SidecarGetResult>(ceremony.kind, params, {
        id: ceremony.id,
        onEvent: (event) => this.onSidecarEvent(ceremony, transport, event),
      })
      .then(
        (result) => {
          ceremony.running = false;
          const matches = clientDataMatches(Buffer.from(result.clientDataJSON ?? '', 'base64url'), {
            type: ceremony.kind === 'create' ? 'webauthn.create' : 'webauthn.get',
            challenge: ceremony.options.challenge,
            origin: ceremony.origin,
          });
          if (!matches) {
            logger.warn('Passkey helper returned client data for another request', {
              ceremonyId: ceremony.id,
            });
            this.fail(ceremony, new SidecarError('Unknown', 'Client data mismatch'));
            return;
          }
          const credential =
            ceremony.kind === 'create'
              ? createdCredential(
                  result as SidecarCreateResult,
                  (ceremony.options as PasskeyPageCreateOptions).extensions?.credProps === true,
                )
              : assertedCredential(result as SidecarGetResult);
          logger.info('Passkey ceremony finished', { ceremonyId: ceremony.id });
          this.finish(ceremony, { ok: true, credential }, null);
        },
        (error) => {
          ceremony.running = false;
          this.fail(ceremony, error);
        },
      );
  }

  private onSidecarEvent(
    ceremony: Ceremony,
    transport: PasskeyTransport,
    event: SidecarEvent,
  ): void {
    if (ceremony.settled) return;
    switch (event.event) {
      case 'qr':
        ceremony.qr = event.data;
        this.show(ceremony, { step: 'qr', data: event.data, progress: 'waiting-for-phone' });
        return;
      case 'status': {
        const progress = PHONE_PROGRESS.has(event.state as PasskeyProgress)
          ? (event.state as PasskeyProgress)
          : 'processing';
        if (progress === 'waiting-for-phone' && ceremony.qr) {
          this.show(ceremony, { step: 'qr', data: ceremony.qr, progress });
        } else {
          this.show(ceremony, { step: 'progress', transport, progress });
        }
        return;
      }
      case 'pin-needed':
        this.show(ceremony, {
          step: 'pin',
          wrongPin: event.wrongPin === true,
          ...(typeof event.attemptsLeft === 'number' ? { attemptsLeft: event.attemptsLeft } : {}),
          ...(typeof event.retryAfterMs === 'number' ? { retryAfterMs: event.retryAfterMs } : {}),
        });
        return;
      case 'choose-account':
        this.show(ceremony, {
          step: 'choose-account',
          accounts: event.accounts.map((account) => ({
            index: account.index,
            userName: account.userName ?? '',
            userDisplayName: account.userDisplayName ?? '',
          })),
        });
        return;
    }
  }

  private fail(ceremony: Ceremony, error: unknown): void {
    const code = error instanceof SidecarError ? error.code : 'Unknown';
    logger.info('Passkey ceremony failed', { ceremonyId: ceremony.id, code });
    this.finish(
      ceremony,
      failure(pageErrorName(code), 'The operation either timed out or was not allowed.'),
      dialogErrorReason(code, ceremony.bluetooth),
    );
  }

  private timeout(ceremony: Ceremony): void {
    if (ceremony.settled) return;
    this.cancelSidecar(ceremony);
    this.finish(
      ceremony,
      failure('NotAllowedError', 'The operation either timed out or was not allowed.'),
      'timeout',
    );
  }

  private abort(ceremony: Ceremony, name: PasskeyPageErrorName, message: string): void {
    if (!ceremony.settled) {
      this.cancelSidecar(ceremony);
      this.finish(ceremony, failure(name, message), null);
    }
    this.close(ceremony);
  }

  private cancelSidecar(ceremony: Ceremony): void {
    if (!ceremony.running) return;
    ceremony.running = false;
    void this.sidecar.request('cancel', { ceremony: ceremony.id }).catch(() => {});
  }

  /** Settles the page request; with `errorReason` the dialog stays open to say why. */
  private finish(
    ceremony: Ceremony,
    result: PasskeyPageResult,
    errorReason: PasskeyErrorReason | null,
  ): void {
    if (ceremony.settled) return;
    ceremony.settled = true;
    ceremony.dispose();
    if (this.byGuest.get(ceremony.guest.id) === ceremony) this.byGuest.delete(ceremony.guest.id);
    ceremony.resolve(result);
    if (errorReason) this.show(ceremony, { step: 'error', reason: errorReason });
    else this.close(ceremony);
  }

  private show(ceremony: Ceremony, view: PasskeyDialogView): void {
    if (ceremony.closed || ceremony.host.isDestroyed()) return;
    ceremony.shown = true;
    ceremony.host.send(CHANNELS.DIALOG_SHOW, {
      ceremonyId: ceremony.id,
      kind: ceremony.kind,
      rpId: ceremony.rpId,
      view,
    });
  }

  private close(ceremony: Ceremony): void {
    this.byId.delete(ceremony.id);
    if (ceremony.closed) return;
    ceremony.closed = true;
    if (ceremony.shown && !ceremony.host.isDestroyed()) {
      ceremony.host.send(CHANNELS.DIALOG_CLOSE, { ceremonyId: ceremony.id });
    }
  }
}
