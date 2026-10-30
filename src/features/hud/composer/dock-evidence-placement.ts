/**
 * Pre-admission placement of dock screen evidence: each burned composite, then
 * (only on daemons advertising `server.capabilities.rawScreenshotRetention === 1`)
 * its raw original associated with that composite.
 *
 * Every request is bound to the backend captured at the click: the transport,
 * its connection generation and the window backend id are checked before and
 * after each call (including every upload chunk, commit and key lookup), so
 * chunks and late completions never land on another backend. Keys are recorded before each request so the next click resumes by
 * key (lost reply) instead of placing twice. Retention is claimed only from a
 * verified server echo; the deadline is the server's, never computed here.
 */
import { observeBackendNodeCapabilities } from '$lib/client/live/backend-transport';
import { resolveBackendTransport } from '$lib/client/live/backend-transport-factory';
import { store as appStore } from '$store/renderer/store';
import {
  abortAttachmentUpload,
  beginAttachmentUpload,
  commitAttachmentUpload,
  getAttachmentInfo,
  placeAttachment,
  sendAttachmentUploadChunk,
  type AttachmentInfo,
  type PlaceAttachmentResult,
  type RawScreenshotPlacement,
} from '$lib/components/chat/input/context-api';
import { placeImageAttachment } from '$lib/components/chat/input/image-attachment-placement';
import { mintPlacementIdempotencyKey } from '$lib/components/chat/input/attachment-placement';
import type { DockEvidenceImage, DockImagePlacementRecord } from '$shared/dock-evidence';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

/** The backend a click belongs to: transport identity, connection generation and window backend. */
export interface DockPlacementBinding {
  backendId: string | null;
  generation: number;
  transport: unknown;
}

function currentTransport(): unknown {
  try {
    return resolveBackendTransport();
  } catch {
    return null;
  }
}

/** Synchronously capture the backend the click belongs to. */
export function captureDockPlacementBinding(): DockPlacementBinding {
  return {
    backendId: appStore.state.connections.windowBackendId ?? null,
    generation: appStore.state.daemonHealth.connectionGeneration,
    transport: currentTransport(),
  };
}

export class DockPlacementBackendChangedError extends Error {
  constructor() {
    super('dock-evidence-backend-changed');
  }
}

export interface DockPlacementApi {
  current(binding: DockPlacementBinding): boolean;
  /** The acknowledged hello's server capabilities on the current transport (never a new hello). */
  capabilities(): Promise<unknown>;
  /** `check` must run before and after every underlying request (chunks, commit, recovery). */
  placeImage(
    workspaceId: string,
    fileName: string,
    source: {
      data: string;
      mimeType: string;
      idempotencyKey?: string;
      rawScreenshot?: RawScreenshotPlacement;
    },
    check: () => void,
  ): Promise<PlaceAttachmentResult>;
  lookup(workspaceId: string, idempotencyKey: string): Promise<AttachmentInfo>;
  mintKey(existing?: string): string | undefined;
}

function bound<A extends unknown[], R>(check: () => void, fn: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    check();
    const result = await fn(...args);
    check();
    return result;
  };
}

const defaultDockPlacementApi: DockPlacementApi = {
  current: (binding) =>
    currentTransport() === binding.transport &&
    appStore.state.daemonHealth.connectionGeneration === binding.generation &&
    (appStore.state.connections.windowBackendId ?? null) === binding.backendId,
  capabilities: () => observeBackendNodeCapabilities(),
  placeImage: (workspaceId, fileName, source, check) =>
    placeImageAttachment(workspaceId, fileName, source, {
      placeAttachment: bound(check, placeAttachment),
      beginAttachmentUpload: bound(check, beginAttachmentUpload),
      sendAttachmentUploadChunk: bound(check, sendAttachmentUploadChunk),
      commitAttachmentUpload: bound(check, commitAttachmentUpload),
      // Aborting an abandoned session is harmless cleanup on the original backend only.
      abortAttachmentUpload: bound(check, abortAttachmentUpload),
      getAttachmentInfo: bound(check, getAttachmentInfo),
      mintIdempotencyKey: mintPlacementIdempotencyKey,
    }),
  lookup: (workspaceId, idempotencyKey) => getAttachmentInfo({ workspaceId, idempotencyKey }),
  mintKey: mintPlacementIdempotencyKey,
};

/** Whether later requests would still reach the backend connection a binding captured. */
export function isDockBindingCurrent(binding: DockPlacementBinding): boolean {
  return defaultDockPlacementApi.current(binding);
}

function guard(api: DockPlacementApi, binding: DockPlacementBinding): () => void {
  return () => {
    if (!api.current(binding)) throw new DockPlacementBackendChangedError();
  };
}

/** Strict capability reading of the acknowledged hello on the bound backend. */
export interface DockAttachmentCapabilities {
  /** `rawScreenshotRetention === 1`: raw originals may be associated and retained. */
  rawRetention: boolean;
  /** `chiefAttachments === 1`: the assistant workspace has an attachment registry. */
  chiefAttachments: boolean;
}

const NO_CAPABILITIES: DockAttachmentCapabilities = Object.freeze({
  rawRetention: false,
  chiefAttachments: false,
});

/** False for the fallback returned when nothing could be read from an acknowledged hello. */
export function isDockCapabilitiesObserved(capabilities: DockAttachmentCapabilities): boolean {
  return capabilities !== NO_CAPABILITIES;
}
const capabilityProbes = new Map<string, Promise<DockAttachmentCapabilities>>();

/**
 * Read `{ server: { capabilities } }` from the transport's acknowledged hello
 * (never a new hello), once per backend connection. Absent, non-integer or
 * unreadable → no capability (no raw upload, assistant stays inline).
 */
export function probeDockAttachmentCapabilities(
  binding: DockPlacementBinding,
  api: DockPlacementApi = defaultDockPlacementApi,
): Promise<DockAttachmentCapabilities> {
  const key = `${binding.backendId}:${binding.generation}`;
  let probe = capabilityProbes.get(key);
  if (!probe) {
    const check = guard(api, binding);
    const attempt = (async () => {
      check();
      const hello = (await api.capabilities()) as {
        server?: {
          capabilities?: { rawScreenshotRetention?: unknown; chiefAttachments?: unknown } | null;
        };
      } | null;
      check();
      const capabilities = hello?.server?.capabilities;
      // Before the hello is acknowledged the snapshot is null: report nothing and
      // do not cache, so the next read on this connection observes the real flags.
      if (!capabilities || typeof capabilities !== 'object') throw new Error('unobserved');
      return {
        rawRetention: capabilities.rawScreenshotRetention === 1,
        chiefAttachments: capabilities.chiefAttachments === 1,
      };
    })();
    probe = attempt.catch(() => {
      capabilityProbes.delete(key);
      return NO_CAPABILITIES;
    });
    capabilityProbes.set(key, probe);
  }
  return probe;
}

/**
 * The advertised retention contract was violated (no or mismatched echo, a
 * non-expiry refusal, or no keyed placement). Fails the send before admission
 * with every key and placed reference kept, so the next click resumes by key.
 */
export class DockRawRetentionContractError extends Error {
  constructor(readonly reason: 'unkeyed' | 'echo' | 'refused') {
    super(`dock-raw-retention-contract:${reason}`);
  }
}

export function __resetDockRetentionProbesForTests(): void {
  capabilityProbes.clear();
}

function isInvalidParams(error: unknown): boolean {
  const { rpcCode, code } = (error ?? {}) as { rpcCode?: unknown; code?: unknown };
  return rpcCode === -32602 || code === 'INVALID_PARAMS';
}

/** Terminal: a keyed raw replayed after its deadline is never renewed or re-placed. */
function isExpiredRawError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? '');
  // The router prefixes the message ("invalid params: rawScreenshotExpired: …"), so the
  // stable code is matched anywhere; the descriptive tail is a fallback.
  return (
    isInvalidParams(error) &&
    (message.includes('rawScreenshotExpired:') || /expired at .*not renewable/i.test(message))
  );
}

/**
 * Accept retention only from an echo naming this composite with a future
 * server deadline. 'expired' is the only terminal non-claim; anything else is
 * a contract violation.
 */
function verifiedRaw(
  result: PlaceAttachmentResult,
  compositeId: string,
  now: number,
): { attachmentId: string; expiresAt: string } | 'expired' | null {
  const echo = result.rawScreenshot;
  if (!echo || echo.compositeAttachmentId !== compositeId) return null;
  const deadline = Date.parse(echo.expiresAt);
  if (!Number.isFinite(deadline)) return null;
  if (echo.expired || deadline <= now) return 'expired';
  return { attachmentId: result.attachmentId, expiresAt: echo.expiresAt };
}

function lookupAsPlacement(info: AttachmentInfo): PlaceAttachmentResult {
  return {
    ok: true,
    path: info.path,
    fileName: info.fileName,
    size: info.size,
    attachmentId: info.attachmentId,
    ...(info.mimeType ? { mimeType: info.mimeType } : {}),
    uploadedAt: info.uploadedAt,
    replayed: true,
    ...(info.rawScreenshot ? { rawScreenshot: info.rawScreenshot } : {}),
  };
}

export interface DockPlacementImage {
  image: DockEvidenceImage;
  signature: string;
  composite: { base64: string; mimeType: string };
  /** Raw original; only uploaded when the daemon advertises retention. */
  raw: { base64: string; mimeType: string } | null;
}

export class DockEvidencePlacementError extends Error {
  constructor(
    readonly imageId: string,
    readonly failure: unknown,
  ) {
    super('dock-evidence-placement-failed');
  }
}

const extension = (mimeType: string) => mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';

/**
 * Place every composite (and verified raw) in tile order. Progress is reported
 * through `onRecord` before and after each request; on failure the records
 * already reported remain the resumable state and the error names the image.
 */
export async function placeDockEvidenceImages(input: {
  workspaceId: string;
  binding: DockPlacementBinding;
  images: readonly DockPlacementImage[];
  records: Readonly<Record<string, DockImagePlacementRecord>>;
  onRecord: (record: DockImagePlacementRecord) => void;
  api?: DockPlacementApi;
  now?: () => number;
}): Promise<DockImagePlacementRecord[]> {
  const api = input.api ?? defaultDockPlacementApi;
  const now = input.now ?? Date.now;
  const check = guard(api, input.binding);
  check();
  const capabilities = await probeDockAttachmentCapabilities(input.binding, api);
  check();
  // The assistant workspace needs its own registry capability as well.
  const retention =
    capabilities.rawRetention &&
    (input.workspaceId !== CHIEF_WORKSPACE_ID || capabilities.chiefAttachments);
  const placed: DockImagePlacementRecord[] = [];
  for (const item of input.images) {
    const prior = input.records[item.image.id];
    let record: DockImagePlacementRecord =
      prior &&
      prior.signature === item.signature &&
      prior.workspaceId === input.workspaceId &&
      prior.backendId === input.binding.backendId
        ? prior
        : {
            imageId: item.image.id,
            signature: item.signature,
            workspaceId: input.workspaceId,
            backendId: input.binding.backendId,
            compositeKey: null,
            rawKey: null,
            composite: null,
            raw: null,
            rawSettled: false,
          };
    const save = (next: DockImagePlacementRecord) => {
      record = next;
      input.onRecord(next);
    };
    try {
      if (!record.composite) {
        const resumed = record.compositeKey;
        const key = api.mintKey(resumed ?? undefined) ?? null;
        if (key !== record.compositeKey) save({ ...record, compositeKey: key });
        let result: PlaceAttachmentResult | undefined;
        // A key from an earlier click may already be bound (its reply was lost).
        if (resumed && key === resumed) {
          check();
          result = await api
            .lookup(input.workspaceId, key)
            .then(lookupAsPlacement)
            .catch(() => undefined);
          check();
        }
        if (!result) {
          check();
          result = await api.placeImage(
            input.workspaceId,
            `screenshot-${item.image.id.slice(0, 8)}.${extension(item.composite.mimeType)}`,
            {
              data: item.composite.base64,
              mimeType: item.composite.mimeType,
              ...(key ? { idempotencyKey: key } : {}),
            },
            check,
          );
          check();
        }
        save({
          ...record,
          composite: {
            attachmentId: result.attachmentId,
            mimeType: result.mimeType ?? item.composite.mimeType,
          },
        });
      }
      const compositeId = record.composite!.attachmentId;
      if (retention && item.raw && !record.raw && !record.rawSettled) {
        const resumed = record.rawKey;
        const key = api.mintKey(resumed ?? undefined);
        // Raw association requires keyed placement; retention advertised without it is a
        // contract violation, and no raw bytes are sent.
        if (!key) throw new DockRawRetentionContractError('unkeyed');
        else {
          if (key !== record.rawKey) save({ ...record, rawKey: key });
          let result: PlaceAttachmentResult | undefined;
          if (resumed && key === resumed) {
            check();
            result = await api
              .lookup(input.workspaceId, key)
              .then(lookupAsPlacement)
              .catch(() => undefined);
            check();
          }
          try {
            if (!result) {
              check();
              result = await api.placeImage(
                input.workspaceId,
                `screenshot-${item.image.id.slice(0, 8)}-original.${extension(item.raw.mimeType)}`,
                {
                  data: item.raw.base64,
                  mimeType: item.raw.mimeType,
                  idempotencyKey: key,
                  rawScreenshot: { compositeAttachmentId: compositeId },
                },
                check,
              );
              check();
            }
            const raw = verifiedRaw(result, compositeId, now());
            if (raw === 'expired') save({ ...record, rawSettled: true });
            else if (raw) save({ ...record, raw });
            else throw new DockRawRetentionContractError('echo');
          } catch (error) {
            // Only a terminal expiry degrades to composite-only (never renewed). Any other
            // refusal or transport failure fails before admission with the key kept.
            if (isExpiredRawError(error)) save({ ...record, rawSettled: true });
            else if (error instanceof DockRawRetentionContractError) throw error;
            else if (isInvalidParams(error)) throw new DockRawRetentionContractError('refused');
            else throw error;
          }
        }
      }
    } catch (error) {
      if (error instanceof DockPlacementBackendChangedError) throw error;
      throw new DockEvidencePlacementError(item.image.id, error);
    }
    placed.push(record);
  }
  return placed;
}
