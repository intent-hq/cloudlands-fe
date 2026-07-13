/**
 * File IPC bridge — routes the legacy renderer→main `file:*` operations onto
 * the daemon-owned filesystem surface so the daemon host stays the single
 * filesystem locus (the renderer never touches the disk itself).
 *
 * Channels served here and their daemon arms (PROTOCOL §5.9 / §5.14):
 *  - `file:read`   → `file.read`  (bare UTF-8 string; folded into the legacy
 *    `{ success, content, data: { content } }` double shape — the explorer
 *    reads top-level `content`, context-api/diff-viewer read `data.content`).
 *  - `file:write`  → `file.write` (UTF-8 only; `encoding: 'base64'` binary
 *    writes have no daemon arm and fail shaped — the FilesPanel drop flow
 *    folds that into its failed-files toast).
 *  - `file:open` / `file:save` → `file.read` / `file.write` (the file-explorer
 *    route's load/save pair, which uses `{ path }` / `{ filePath, content }`).
 *  - `file:delete` → `file.delete`, `file:move` → `file.rename`.
 *  - `file:copy`   → `file.read` + `file.write` compose (files only —
 *    directory copies fail shaped exactly like an unreadable source).
 *  - `file:exists` → `host.directoryStatus.exists` (a host-level probe that
 *    accepts any path and reports plain fs existence).
 *
 * Daemon `file.*` methods require a `workspaceId` and enforce within-workspace
 * path containment. Call sites pass absolute paths inside the workspace root
 * (the explorer CRUD is documented as absolute-path legacy IPC); when a call
 * site omits `workspaceId`, the active workspace is resolved from the store
 * (lazily imported to avoid a seeder↔store import cycle).
 *
 * Every handler preserves the legacy envelope its call sites already consume
 * (`file:read`/`file:write` used `IpcResponse` object errors; the rest used
 * `{ success, error: string }`) — contents come from the daemon host, never
 * synthesized. Handlers are registered at import time (host-bridge idiom).
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { backendRequest } from '$lib/client/live/backend-transport';

/** Coerce a possibly-unknown argument into a plain object record. */
function asRecord(arg: unknown): Record<string, unknown> {
  return arg && typeof arg === 'object' ? (arg as Record<string, unknown>) : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Resolve the workspace the daemon should scope the operation to: the explicit
 * `workspaceId` argument when the call site provides one, else the active
 * workspace from the store. The store and selector are imported lazily because
 * the seeder barrel loads during store bootstrap.
 */
async function resolveWorkspaceId(record: Record<string, unknown>): Promise<string | null> {
  const explicit = readString(record, 'workspaceId');
  if (explicit) return explicit;
  try {
    const [{ store }, { selectActiveWorkspaceId }] = await Promise.all([
      import('$store/renderer/store'),
      import('$store/renderer/slices/workspace/workspace-selectors'),
    ]);
    const active = selectActiveWorkspaceId.select(store.state);
    return typeof active === 'string' && active ? active : null;
  } catch {
    return null;
  }
}

/** Daemon `file.read` (bare string result). */
async function daemonRead(workspaceId: string, path: string): Promise<string> {
  return await backendRequest<string>('file.read', { workspaceId, path });
}

/** Daemon `file.write` (`{ ok, path, size }`; parents are created). */
async function daemonWrite(workspaceId: string, path: string, content: string): Promise<void> {
  await backendRequest('file.write', { workspaceId, path, content });
}

// ── file:read ──

registerMockIpcHandler(IPC_CHANNELS.FILE.READ, async (arg) => {
  const request = asRecord(arg);
  const path = readString(request, 'path');
  if (!path) {
    return { success: false, error: { code: 'INVALID_REQUEST', message: 'path is required' } };
  }
  const workspaceId = await resolveWorkspaceId(request);
  if (!workspaceId) {
    return {
      success: false,
      error: { code: 'NO_WORKSPACE', message: 'No workspace available for file.read' },
    };
  }
  try {
    const content = await daemonRead(workspaceId, path);
    // Double shape: top-level `content` for the explorer's undo read, the
    // `IpcResponse` envelope (`data.content`) for context-api / diff viewers.
    return { success: true, content, data: { content, isBinary: false, truncated: false } };
  } catch (error) {
    return { success: false, error: { code: 'FILE_READ_FAILED', message: errorMessage(error) } };
  }
});

// ── file:write ──

registerMockIpcHandler(IPC_CHANNELS.FILE.WRITE, async (arg) => {
  const request = asRecord(arg);
  const path = readString(request, 'path');
  const content = typeof request.content === 'string' ? (request.content as string) : undefined;
  if (!path || content === undefined) {
    return {
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'path and content are required' },
    };
  }
  if (request.encoding === 'base64') {
    // The daemon file.write is UTF-8 text only (PROTOCOL §5.9) — there is no
    // binary-write arm. FilesPanel folds this into its failed-files toast.
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_ENCODING',
        message: 'Binary (base64) file writes are not supported over the daemon file.write',
      },
    };
  }
  const workspaceId = await resolveWorkspaceId(request);
  if (!workspaceId) {
    return {
      success: false,
      error: { code: 'NO_WORKSPACE', message: 'No workspace available for file.write' },
    };
  }
  try {
    await daemonWrite(workspaceId, path, content);
    return { success: true, data: { bytesWritten: content.length } };
  } catch (error) {
    return { success: false, error: { code: 'FILE_WRITE_FAILED', message: errorMessage(error) } };
  }
});

// ── file:open / file:save (file-explorer route load/save pair) ──

registerMockIpcHandler('file:open', async (arg) => {
  const request = asRecord(arg);
  const path = readString(request, 'path');
  if (!path) return { success: false, error: 'path is required' };
  const workspaceId = await resolveWorkspaceId(request);
  if (!workspaceId) return { success: false, error: 'No workspace available for file.read' };
  try {
    const content = await daemonRead(workspaceId, path);
    return { success: true, content };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

registerMockIpcHandler('file:save', async (arg) => {
  const request = asRecord(arg);
  const path = readString(request, 'filePath');
  const content = typeof request.content === 'string' ? (request.content as string) : undefined;
  if (!path || content === undefined) {
    return { success: false, error: 'filePath and content are required' };
  }
  const workspaceId = await resolveWorkspaceId(request);
  if (!workspaceId) return { success: false, error: 'No workspace available for file.write' };
  try {
    await daemonWrite(workspaceId, path, content);
    return { success: true };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// ── file:exists ──

registerMockIpcHandler(IPC_CHANNELS.FILE.EXISTS, async (arg) => {
  const request = asRecord(arg);
  const path = readString(request, 'path');
  if (!path) return { success: false, exists: false, error: 'path is required' };
  try {
    // Host-level probe (PROTOCOL §5.14): accepts any path, no workspace scope
    // needed — mirrors the legacy handler's plain fs.access existence check.
    const status = await backendRequest<{ exists: boolean }>('host.directoryStatus', { path });
    const exists = status.exists === true;
    return { success: true, exists, data: exists };
  } catch (error) {
    return { success: false, exists: false, error: errorMessage(error) };
  }
});

// ── file:delete ──

registerMockIpcHandler(IPC_CHANNELS.FILE.DELETE, async (arg) => {
  const request = asRecord(arg);
  const path = readString(request, 'path');
  if (!path) return { success: false, error: 'path is required' };
  const workspaceId = await resolveWorkspaceId(request);
  if (!workspaceId) return { success: false, error: 'No workspace available for file.delete' };
  try {
    await backendRequest('file.delete', { workspaceId, path });
    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// ── file:move ──

registerMockIpcHandler(IPC_CHANNELS.FILE.MOVE, async (arg) => {
  const request = asRecord(arg);
  const oldPath = readString(request, 'oldPath');
  const newPath = readString(request, 'newPath');
  if (!oldPath || !newPath) {
    return { success: false, error: 'oldPath and newPath are required' };
  }
  const workspaceId = await resolveWorkspaceId(request);
  if (!workspaceId) return { success: false, error: 'No workspace available for file.rename' };
  try {
    await backendRequest('file.rename', { workspaceId, oldPath, newPath });
    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// ── file:copy ──

registerMockIpcHandler(IPC_CHANNELS.FILE.COPY, async (arg) => {
  const request = asRecord(arg);
  const sourcePath = readString(request, 'sourcePath');
  const destinationPath = readString(request, 'destinationPath');
  if (!sourcePath || !destinationPath) {
    return { success: false, error: 'sourcePath and destinationPath are required' };
  }
  const workspaceId = await resolveWorkspaceId(request);
  if (!workspaceId) return { success: false, error: 'No workspace available for file.read/write' };
  try {
    // Compose read+write: the daemon has no copy RPC. Directory sources fail
    // on the read (like any unreadable source) and surface the fs error.
    const content = await daemonRead(workspaceId, sourcePath);
    await daemonWrite(workspaceId, destinationPath, content);
    return { success: true, data: { isDirectory: false } };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});
