/**
 * Transport-aware attachment placement (`file.placeAttachment`, PROTOCOL
 * §5.9). The daemon's `sourcePath` arm copies from a path on the DAEMON's
 * host, so it only works when the FE and daemon share a machine (local UDS
 * sidecar). Against a remote backend the FE reads the file bytes off its own
 * disk (main-process `file:read`, base64) and sends them via the `data` arm
 * instead — the 2.27.0 remote-attachment regression (monorepo#2144).
 */
import { invoke } from '$lib/electron-bridge';
import { store as appStore } from '$store/renderer/store';
import { selectIsDaemonLocal } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import { placeAttachment, type PlaceAttachmentResult } from './context-api';

/**
 * Byte cap for the remote `data` arm. Base64 inflates by 4/3 and the
 * serialized JSON-RPC frame is capped at 40 MiB (PROTOCOL §1.3), so raw
 * bytes must stay well under that; 25 MB matches the daemon's serialized
 * `attachments` payload cap precedent.
 */
export const MAX_REMOTE_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * True when the daemon host is NOT the user's machine, i.e. `sourcePath`
 * placement cannot work because the daemon has no access to the FE host's
 * filesystem. Uses the daemon-reported locality (transport heuristic before
 * the first status poll) — same signal that gates other host-local
 * affordances like reveal-in-file-manager.
 */
export function isRemoteBackend(): boolean {
  return !selectIsDaemonLocal.select(appStore.state);
}

/** Main-process `file:read` response envelope (see `file.ipc.ts`). */
interface FileReadIpcResult {
  success: boolean;
  data?: { content: string; truncated?: boolean };
  error?: { code: string; message: string };
}

const UNEXPECTED_READ_RESPONSE_MESSAGE = 'file:read returned an unexpected response'; // i18n-ignore (internal error, filtered from detail — surfaced via generic toast)
const READ_FAILED_MESSAGE = 'file:read failed'; // i18n-ignore (fallback for missing IPC error message, filtered from detail)

/** Read a host-local file as base64 via the main-process `file:read` IPC. */
async function readFileBase64(path: string): Promise<string> {
  const result = await invoke<FileReadIpcResult>('file:read', {
    path,
    encoding: 'base64',
    maxSize: MAX_REMOTE_ATTACHMENT_BYTES,
    truncateIfLarge: false,
  });
  if (!result || typeof result !== 'object' || !('success' in result)) {
    throw new Error(UNEXPECTED_READ_RESPONSE_MESSAGE);
  }
  if (!result.success || result.data?.content === undefined) {
    throw new Error(result.error?.message ?? READ_FAILED_MESSAGE);
  }
  return result.data.content;
}

/**
 * Messages too generic to render as the user-visible failure reason: the
 * daemon's bare `-32603` message, the electron-ipc-transport fallback for a
 * payload-less IPC failure, and this module's own `file:read` envelope
 * fallbacks. Filtering them keeps the tooltip/toast detail daemon-reasons
 * (or informative IPC reasons) only, so untranslated fallbacks never render.
 */
const GENERIC_PLACEMENT_MESSAGES = new Set([
  'Internal error', // i18n-ignore (verbatim daemon -32603 message, filtered)
  'Backend request failed', // i18n-ignore (verbatim electron-ipc-transport fallback, filtered)
  UNEXPECTED_READ_RESPONSE_MESSAGE,
  READ_FAILED_MESSAGE,
]);

/**
 * Place an attachment picking the arm by backend locality: `sourcePath`
 * (daemon copies directly, no bytes on the wire) against the local sidecar,
 * `data` (base64 bytes read off the FE host) against a remote backend.
 * Signature matches `placeAttachment` minus the `data` field so call sites
 * and their retry paths swap in without change. Errors propagate — use
 * `extractPlacementErrorDetail` to surface the daemon's reason.
 */
export async function placeAttachmentViaTransport(
  workspaceId: string,
  fileName: string,
  source: { sourcePath: string; mimeType?: string },
): Promise<PlaceAttachmentResult> {
  if (!isRemoteBackend()) {
    return placeAttachment(workspaceId, fileName, {
      sourcePath: source.sourcePath,
      mimeType: source.mimeType,
    });
  }
  const data = await readFileBase64(source.sourcePath);
  return placeAttachment(workspaceId, fileName, { data, mimeType: source.mimeType });
}

/**
 * Extract a human-readable failure reason from a placement error for the
 * failed pill tooltip / toast. Prefers the daemon's structured
 * `error.data.detail` (the transport maps a plain-string JSON-RPC `data`
 * there), then a non-generic error message (`-32602` messages carry the
 * classified reason, e.g. "sourcePath is a directory"); returns undefined
 * for generic transport/daemon fallbacks so callers keep the localized
 * generic copy.
 */
export function extractPlacementErrorDetail(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === 'object') {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim().length > 0) return detail.trim();
  }
  const message = (error as { message?: unknown }).message;
  if (
    typeof message === 'string' &&
    message.trim().length > 0 &&
    !GENERIC_PLACEMENT_MESSAGES.has(message.trim())
  ) {
    return message.trim();
  }
  return undefined;
}
