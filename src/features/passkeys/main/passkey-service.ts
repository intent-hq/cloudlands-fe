import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent, Session, WebContents, WebFrameMain } from 'electron';
import { z } from 'zod';
import type { BrowserPanelPageOwner } from '../../../main/browser-panel-pages';
import { Logger } from '../../../shared/logger';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import type {
  PasskeyCeremonyKind,
  PasskeyCredentialDescriptor,
  PasskeyDeviceCredential,
  PasskeyDeviceDeleteResult,
  PasskeyDeviceListResult,
  PasskeyDialogView,
  PasskeyErrorReason,
  PasskeyPageCreateOptions,
  PasskeyPageErrorName,
  PasskeyPageCapabilities,
  PasskeyPageGetOptions,
  PasskeyPageResult,
  PasskeyProgress,
  PasskeyTransport,
} from '../../../shared/ipc/passkeys';
import { checkFrameOrigin, isValidRpIdForHost } from './passkey-origin';
import {
  SidecarError,
  type PasskeySidecar,
  type SidecarDeviceCredential,
  type SidecarEvent,
} from './passkey-sidecar';
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
  .max(262_144);
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

const DeviceDeleteSchema = z.object({ credentialId: base64url.min(1) });

const DialogResponseSchema = z.discriminatedUnion('action', [
  z.object({
    ceremonyId: z.string(),
    action: z.literal('transport'),
    transport: z.enum(['hybrid', 'usb', 'device']),
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
  /** "This device" is offered: the helper has device passkeys and the site allows a platform authenticator. */
  device: boolean;
  transport: PasskeyTransport | null;
  /** Device create on a device with no passkeys yet (PIN strength advice). */
  firstPasskey: boolean;
  /** The last PIN prompt asked for the previous PIN (a wrong one ends with NotAllowed). */
  askedOldPin: boolean;
  qr: string | null;
  running: boolean;
  settled: boolean;
  /** The dialog was shown; it can outlive the page request to show an error. */
  shown: boolean;
  closed: boolean;
  resolve: (result: PasskeyPageResult) => void;
  dispose: () => void;
  /** Stops listening for page moves (on close: a move also closes an error dialog). */
  stopMoveWatch: () => void;
}

/** Who owns a browser-panel page now (`main/browser-panel-pages.ts`). */
export interface PasskeyPageOwners {
  /** The page's owner from main's records, or null for anything but a live browser-panel page. */
  ownerOf(contents: WebContents): BrowserPanelPageOwner | null;
  /** Calls `listener` when a main-owned page moves to another window; returns the disposer. */
  onMoved(listener: (webContentsId: number) => void): () => void;
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

function deviceCredential(entry: SidecarDeviceCredential): PasskeyDeviceCredential | null {
  if (typeof entry?.credentialId !== 'string' || typeof entry.rpId !== 'string') return null;
  if (typeof entry.createdAt !== 'number') return null;
  return {
    credentialId: entry.credentialId,
    rpId: entry.rpId,
    userName: entry.userName ?? '',
    userDisplayName: entry.userDisplayName ?? '',
    createdAt: entry.createdAt,
    lastUsedAt: typeof entry.lastUsedAt === 'number' ? entry.lastUsedAt : null,
  };
}

/**
 * Runs WebAuthn ceremonies for browser-panel pages (`<webview>` guests and
 * main-owned pages): one at a time per page, with the Intent dialog in the
 * app renderer that owns the page. A main-owned page that moves to another
 * window ends its ceremony (AbortError) and closes the dialog.
 */
export class PasskeyService {
  private readonly byId = new Map<string, Ceremony>();
  private readonly byGuest = new Map<number, Ceremony>();

  constructor(
    private readonly sidecar: PasskeySidecar,
    private readonly browserSession: () => Session,
    private readonly pages: PasskeyPageOwners,
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
    const owner = this.ownerOf(guest);
    if (!owner) {
      return failure('NotAllowedError', 'Passkeys are available only in the browser panel.');
    }
    // A page that is not on screen (parked, detached) cannot open a dialog.
    if (!owner.shown) return failure('NotAllowedError', 'The page is not on screen.');
    const host = owner.host;
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

    const attachment =
      kind === 'create'
        ? (publicKey as PasskeyPageCreateOptions).authenticatorSelection?.authenticatorAttachment
        : undefined;

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
        device: false,
        transport: null,
        firstPasskey: false,
        askedOldPin: false,
        qr: null,
        running: false,
        settled: false,
        shown: false,
        closed: false,
        resolve,
        dispose: () => {},
        stopMoveWatch: () => {},
      };
      // Track the document before the helper starts, so an abort, navigation
      // or removal while it starts still ends this ceremony.
      this.track(ceremony);
      logger.info('Passkey ceremony started', { ceremonyId: ceremony.id, kind, rpId });
      this.sidecar.start().then(
        (hello) => {
          if (ceremony.settled) return;
          ceremony.bluetooth = hello.bluetooth;
          ceremony.device = hello.transports.device === true && attachment !== 'cross-platform';
          this.show(ceremony, {
            step: 'choose-transport',
            hybrid:
              hello.bluetooth === 'on' && hello.transports.hybrid
                ? 'available'
                : hello.bluetooth === 'missing'
                  ? 'bluetooth-missing'
                  : 'bluetooth-off',
            device: ceremony.device,
          });
        },
        (error: unknown) => {
          logger.warn('Passkey helper unavailable', { error: (error as Error).message });
          this.finish(ceremony, failure('NotAllowedError', 'Passkeys are not available.'), null);
        },
      );
    });
  }

  /** `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable` for a browser-panel page. */
  async handlePageCapabilities(event: IpcMainInvokeEvent): Promise<PasskeyPageCapabilities> {
    const none = { platformAuthenticator: false };
    if (!this.ownerOf(event.sender)) return none;
    const frame = event.senderFrame;
    if (!frame || frame.isDestroyed()) return none;
    if (!checkFrameOrigin(frame.origin, sameOriginWithAncestors(frame)).ok) return none;
    try {
      const hello = await this.sidecar.start();
      return { platformAuthenticator: hello.transports.device === true };
    } catch {
      return none;
    }
  }

  /** Settings → Passkeys. The IPC layer admits app windows only. */
  async listDevicePasskeys(): Promise<PasskeyDeviceListResult> {
    let hello;
    try {
      hello = await this.sidecar.start();
    } catch {
      return { available: false };
    }
    if (hello.transports.device !== true) return { available: false };
    try {
      const result = await this.sidecar.request<{ credentials?: SidecarDeviceCredential[] }>(
        'device.list',
        {},
      );
      const credentials = (Array.isArray(result.credentials) ? result.credentials : [])
        .map(deviceCredential)
        .filter((entry): entry is PasskeyDeviceCredential => entry !== null);
      return { available: true, credentials };
    } catch (error) {
      logger.warn('Listing device passkeys failed', {
        code: error instanceof SidecarError ? error.code : 'Unknown',
      });
      return { available: true, error: true };
    }
  }

  async deleteDevicePasskey(payload: unknown): Promise<PasskeyDeviceDeleteResult> {
    const parsed = DeviceDeleteSchema.safeParse(payload);
    if (!parsed.success) return { ok: false };
    try {
      const hello = await this.sidecar.start();
      if (hello.transports.device !== true) return { ok: false };
      await this.sidecar.request('device.delete', { credentialId: parsed.data.credentialId });
      logger.info('Device passkey deleted');
      return { ok: true };
    } catch (error) {
      logger.warn('Deleting a device passkey failed', {
        code: error instanceof SidecarError ? error.code : 'Unknown',
      });
      return { ok: false };
    }
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
    if (this.movedAway(ceremony)) {
      this.abort(ceremony, 'AbortError', 'The page moved to another window.');
      return;
    }

    if (response.action === 'cancel') {
      if (ceremony.settled) this.close(ceremony);
      else this.abort(ceremony, 'NotAllowedError', 'The user cancelled the request.');
      return;
    }
    if (ceremony.settled) return;
    try {
      if (response.action === 'transport') {
        if (ceremony.running || ceremony.transport) return;
        if (response.transport === 'device' && !ceremony.device) return;
        await this.begin(ceremony, response.transport);
      } else {
        if (!ceremony.running) return;
        const transport = ceremony.transport ?? 'usb';
        this.show(ceremony, { step: 'progress', transport, progress: 'processing' });
        if (response.action === 'pin') {
          await this.sidecar.request('pin', { ceremony: ceremony.id, pin: response.pin });
        } else {
          await this.sidecar.request('choose', { ceremony: ceremony.id, index: response.index });
        }
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

  /** The owner of a browser-panel page (`<webview>` guest or main-owned page), or null. */
  private ownerOf(contents: WebContents): BrowserPanelPageOwner | null {
    if (contents.isDestroyed()) return null;
    const type = contents.getType();
    // 'window': a main-owned page (WebContentsView); the owner lookup rejects any other.
    if (type !== 'webview' && type !== 'window') return null;
    if (contents.session !== this.browserSession()) return null;
    return this.pages.ownerOf(contents);
  }

  /** The page now belongs to another renderer (or none) than the one showing the dialog. */
  private movedAway(ceremony: Ceremony): boolean {
    return this.ownerOf(ceremony.guest)?.host !== ceremony.host;
  }

  /** True when the device store has no passkeys yet; a failed list shows no advice. */
  private async deviceIsEmpty(): Promise<boolean> {
    try {
      const result = await this.sidecar.request<{ credentials?: unknown[] }>('device.list', {});
      return Array.isArray(result.credentials) && result.credentials.length === 0;
    } catch {
      return false;
    }
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
      } else if (this.movedAway(ceremony)) {
        // Backstop for a move that sent no notice.
        this.abort(ceremony, 'AbortError', 'The page moved to another window.');
      }
    }, FRAME_CHECK_MS);
    const guestId = ceremony.guest.id;
    ceremony.stopMoveWatch = this.pages.onMoved((webContentsId) => {
      if (webContentsId === guestId) {
        this.abort(ceremony, 'AbortError', 'The page moved to another window.');
      }
    });
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

  private async begin(ceremony: Ceremony, transport: PasskeyTransport): Promise<void> {
    if (transport === 'hybrid' && ceremony.bluetooth !== 'on') {
      this.finish(
        ceremony,
        failure('NotAllowedError', 'Bluetooth is not available.'),
        ceremony.bluetooth === 'missing' ? 'bluetooth-missing' : 'bluetooth-off',
      );
      return;
    }
    ceremony.transport = transport;
    this.show(ceremony, { step: 'progress', transport, progress: 'starting' });
    if (transport === 'device' && ceremony.kind === 'create') {
      ceremony.firstPasskey = await this.deviceIsEmpty();
      if (ceremony.settled) return;
    }
    ceremony.running = true;
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
      case 'pin-needed': {
        const kind = event.kind === 'device' ? 'device' : 'usb';
        const oldPin = kind === 'device' && event.oldPin === true;
        ceremony.askedOldPin = oldPin;
        this.show(ceremony, {
          step: 'pin',
          kind,
          wrongPin: event.wrongPin === true,
          ...(typeof event.attemptsLeft === 'number' ? { attemptsLeft: event.attemptsLeft } : {}),
          ...(typeof event.retryAfterMs === 'number' && event.retryAfterMs > 0
            ? { retryAfterMs: event.retryAfterMs }
            : {}),
          ...(oldPin ? { oldPin: true } : {}),
          ...(kind === 'device' && ceremony.firstPasskey && !oldPin ? { firstPasskey: true } : {}),
        });
        return;
      }
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
      dialogErrorReason(code, {
        bluetooth: ceremony.bluetooth,
        transport: ceremony.transport,
        kind: ceremony.kind,
        askedOldPin: ceremony.askedOldPin,
      }),
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
    ceremony.stopMoveWatch();
    if (ceremony.shown && !ceremony.host.isDestroyed()) {
      ceremony.host.send(CHANNELS.DIALOG_CLOSE, { ceremonyId: ceremony.id });
    }
  }
}
