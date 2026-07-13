/**
 * Host IPC bridge — routes legacy renderer→main `system:*` / `file:*` host
 * probes and the editor-open intents (`vscode:open`, `jetbrains:open`,
 * `xcode:open`, `external-editors:open`, `external-editors:detect-installed`)
 * to the daemon-host `host.*` JSON-RPC surface (PROTOCOL §host / §5.14).
 *
 * The renderer's `invoke()` resolves through the in-memory mock IPC router
 * (`$shared/ipc-mock-router`), not the real Electron preload bridge — so the
 * main-process handlers in `features/system/main/system.ipc.ts` +
 * `features/file/main/file.ipc.ts` that already delegate to `host.checkGit` /
 * `host.directoryStatus` (cloudlands-fe PR #5) were never reached from the
 * renderer. The fallthrough returned `undefined`, which made
 * `CompactWorkspaceInitializer`'s git probe report `gitAvailable:false` and
 * every `RepoSelector` / `LocalRepoTab` / `ProjectPickerMessage` directory
 * status check resolve to `null`.
 *
 * Per the integration principle BE = source of truth: each handler forwards
 * to the canonical daemon RPC (`host.checkGit` / `host.directoryStatus`) and
 * wraps the raw daemon response in the `{ success, data }` envelope the
 * existing call sites already consume — never synthesizing data.
 *
 * Handlers are registered at import time (mirroring the
 * `agent-ipc-bridge-seeder` idiom) so the very first home-screen mount sees
 * a real git-availability + directory-status answer.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { backendRequest } from "$lib/client/live/backend-transport";
import { openExternalUrl } from "$lib/utils/open-external";
import { EDITOR_REGISTRY } from "$shared/editors/editor-registry";
import type { InstalledEditor } from "$store/renderer/slices/external-editors/external-editors-slice";

/** Daemon `host.checkGit` response shape (intent-transport host_ops.rs §host). */
interface HostCheckGitResult {
  available: boolean;
  version?: string;
  path?: string;
}

/** Daemon `host.directoryStatus` response shape (intent-transport host_ops.rs §host). */
interface HostDirectoryStatusResult {
  exists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  isGitRepo: boolean;
  isSubdirectoryOfGitRepo: boolean;
  path: string;
  parentGitRoot?: string;
  relativePathFromGitRoot?: string;
}

/** Coerce a possibly-unknown argument into a plain object record. */
function asRecord(arg: unknown): Record<string, unknown> {
  return arg && typeof arg === "object" ? (arg as Record<string, unknown>) : {};
}

/**
 * `system:check-git` → daemon `host.checkGit`.
 *
 * Call sites (e.g. `CompactWorkspaceInitializer.svelte`) read
 * `result.data.available` + `result.data.version`, so we forward the daemon
 * body verbatim under `data`. Any failure folds to `{ available:false }` (the
 * banner-suppressed default) to preserve the prior IPC contract: a missing
 * git binary is never an RPC error.
 */
registerMockIpcHandler(IPC_CHANNELS.SYSTEM.CHECK_GIT, async () => {
  try {
    const result = await backendRequest<HostCheckGitResult>("host.checkGit");
    const available = result?.available === true;
    const version = typeof result?.version === "string" ? result.version : undefined;
    return {
      success: true,
      data: available ? { available: true, version } : { available: false },
    };
  } catch {
    return { success: true, data: { available: false } };
  }
});

/**
 * `file:getDirectoryStatus` → daemon `host.directoryStatus`.
 *
 * Forwards the FE-supplied `{ path }` and surfaces the daemon's
 * `{ exists, isDirectory, isEmpty, isGitRepo, isSubdirectoryOfGitRepo, path,
 * parentGitRoot?, relativePathFromGitRoot? }` shape under `data`. Call sites
 * gate on `result.success && result.data`, so an empty/invalid `path` or a
 * daemon error surfaces as `{ success:false, error }` and the caller falls
 * back to its own null-handling path.
 */
registerMockIpcHandler(IPC_CHANNELS.FILE.GET_DIRECTORY_STATUS, async (arg) => {
  const params = asRecord(arg);
  const rawPath = params.path;
  const path = typeof rawPath === "string" ? rawPath : "";
  if (!path) {
    return { success: false, error: "path is required" };
  }
  try {
    const result = await backendRequest<HostDirectoryStatusResult>(
      "host.directoryStatus",
      { path },
    );
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

/** Daemon `host.findBinary` response shape (intent-transport host_ops.rs §host). */
interface HostFindBinaryResult {
  available: boolean;
  path?: string;
}

/**
 * `system:check-rtk` → daemon `host.findBinary` (name `rtk`).
 *
 * `RtkSettings.svelte` reads `result.data.available` to gate the toggle, so
 * the daemon body folds to `{ available }` under `data`. Mirrors `CHECK_GIT`:
 * a missing rtk binary (or a failed probe) is never an RPC error — it renders
 * as "rtk is not installed" with the re-check affordance.
 */
registerMockIpcHandler(IPC_CHANNELS.SYSTEM.CHECK_RTK, async () => {
  try {
    const result = await backendRequest<HostFindBinaryResult>("host.findBinary", {
      name: "rtk",
    });
    return { success: true, data: { available: result?.available === true } };
  } catch {
    return { success: true, data: { available: false } };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Editor-open intents → `host.openInEditor` / `host.listInstalledEditors`
// (PROTOCOL §5.14). Unlike the probe handlers above, launch failures THROW so
// the mock router rejects and the call sites' catch blocks surface the error
// visibly (toast/log) instead of a silent no-op.
// ─────────────────────────────────────────────────────────────────────────────

/** Daemon `host.listInstalledEditors` entry shape (PROTOCOL §5.14). */
interface HostInstalledEditorEntry {
  id: string;
  installed: boolean;
  path?: string;
  source?: string;
  flatpakId?: string;
}

/** Daemon `host.listInstalledEditors` result shape (PROTOCOL §5.14). */
interface HostListInstalledEditorsResult {
  editors: HostInstalledEditorEntry[];
}

/** Fetch the daemon-host editor catalog (detection runs on the daemon host). */
async function listInstalledEditors(): Promise<HostInstalledEditorEntry[]> {
  const result = await backendRequest<HostListInstalledEditorsResult>(
    "host.listInstalledEditors",
  );
  return Array.isArray(result?.editors) ? result.editors : [];
}

/**
 * Launch an editor on `path` via `host.openInEditor` (PROTOCOL §5.14). Throws
 * on daemon error so the invoking component's catch block surfaces the failure.
 */
async function openInEditor(editorId: string, path: string): Promise<{ success: true }> {
  if (!path) throw new Error("Missing required parameter: path");
  await backendRequest("host.openInEditor", { editorId, path });
  return { success: true };
}

/**
 * Resolve the single `path` §5.14 accepts from the legacy polymorphic
 * `vscode:open` / `jetbrains:open` / `xcode:open` argument shapes
 * (`string | { filePath } | { folder, file? }`). `preferFile` picks the file
 * over its containing folder when both are present (VS Code / JetBrains open
 * the file; Xcode wants the project folder).
 */
function resolveEditorPath(arg: unknown, preferFile: boolean): string {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object") {
    const record = arg as { filePath?: unknown; folder?: unknown; file?: unknown };
    if (typeof record.filePath === "string") return record.filePath;
    const folder = typeof record.folder === "string" ? record.folder : "";
    const file = typeof record.file === "string" ? record.file : "";
    if (preferFile && file) return file;
    return folder || file;
  }
  return "";
}

/** `vscode:open` → `host.openInEditor { editorId: "vscode" }`. */
registerMockIpcHandler("vscode:open", async (arg) =>
  openInEditor("vscode", resolveEditorPath(arg, true)),
);

/**
 * `vscode:open-git-diff` → open the repository folder in VS Code so its native
 * git tooling shows the diff (mirrors the legacy main-process behavior).
 */
registerMockIpcHandler("vscode:open-git-diff", async (arg) => {
  const params = asRecord(arg);
  const workspacePath = typeof params.workspacePath === "string" ? params.workspacePath : "";
  const filePath = typeof params.filePath === "string" ? params.filePath : "";
  return openInEditor("vscode", workspacePath || filePath);
});

/**
 * JetBrains-family catalog ids in launch-priority order (mirrors the legacy
 * main-process selection in ide.ipc.ts; ids match the daemon catalog and the
 * shared EDITOR_REGISTRY).
 */
const JETBRAINS_EDITOR_IDS = [
  "intellij",
  "intellij-ce",
  "webstorm",
  "pycharm",
  "pycharm-ce",
  "rubymine",
  "goland",
  "phpstorm",
] as const;

/** `jetbrains:open` → first installed JetBrains IDE via `host.listInstalledEditors`. */
registerMockIpcHandler("jetbrains:open", async (arg) => {
  const editors = await listInstalledEditors();
  const installed = JETBRAINS_EDITOR_IDS.find((id) =>
    editors.some((entry) => entry.id === id && entry.installed === true),
  );
  if (!installed) {
    throw new Error(
      "No JetBrains IDE found. Please install IntelliJ IDEA, WebStorm, PyCharm, or another JetBrains IDE.",
    );
  }
  return openInEditor(installed, resolveEditorPath(arg, true));
});

/** `xcode:open` → `host.openInEditor { editorId: "xcode" }` on the project folder. */
registerMockIpcHandler("xcode:open", async (arg) =>
  openInEditor("xcode", resolveEditorPath(arg, false)),
);

/** `vscode:openFile` (CodeEditor's "Open in VS Code") → `host.openInEditor { editorId: "vscode" }`. */
registerMockIpcHandler("vscode:openFile", async (arg) => {
  const file = asRecord(arg).file;
  return openInEditor("vscode", typeof file === "string" ? file : "");
});

/**
 * `shell:openExternal` — open a URL on the user's machine. PROTOCOL §5.14
 * defines `host.openExternal` as a daemon→client reverse RPC ("FE-served"):
 * the CLIENT owns opening URLs, so the legacy channel bridges to the shared
 * `openExternalUrl` opener rather than to a daemon call. The opener validates
 * the scheme (http/https only — a bad URL still rejects loudly), prefers the
 * real Electron preload bridge when one exists, and falls back to
 * `window.open` + an anchor click. A refused `window.open` no longer throws:
 * Electron hosts deny it from their window-open handler after opening the
 * URL externally themselves, so treating a null handle as fatal broke every
 * docs link in the packaged build.
 */
registerMockIpcHandler("shell:openExternal", async (arg) => {
  const url = typeof arg === "string" ? arg : String(asRecord(arg).url ?? "");
  await openExternalUrl(url);
  return { success: true };
});

/** `external-editors:open` → `host.openInEditor` with the caller's editor id. */
registerMockIpcHandler("external-editors:open", async (arg) => {
  const params = asRecord(arg);
  const editorId = typeof params.editorId === "string" ? params.editorId : "";
  if (!editorId) throw new Error("Missing required parameter: editorId");
  return openInEditor(editorId, typeof params.path === "string" ? params.path : "");
});

/**
 * `external-editors:open-with-other` — native application chooser dialog. Like
 * `shell:openExternal`, this is CLIENT-owned (PROTOCOL §5.14 `host.pickApplication`
 * is a daemon→client reverse RPC): the daemon has no dialog. When a real
 * Electron preload bridge (`window.electronAPI.invoke`) is present, forward the
 * `{ path }` payload verbatim to the main-process handler
 * (`registerExternalEditorsHandlers` in
 * `features/external-editors/main/external-editors.ipc.ts`) which shows the
 * OS-native picker and spawns the chosen app. When no bridge exists (browser
 * dev / bridge-less build) fold to the documented not-available failure so the
 * callers' toast branch surfaces the gap — the pre-existing behavior when this
 * channel was still an allowlisted absence.
 */
registerMockIpcHandler("external-editors:open-with-other", async (arg) => {
  const params = asRecord(arg);
  const path = typeof params.path === "string" ? params.path : "";
  if (!path) throw new Error("Missing required parameter: path");
  const bridge = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (bridge && typeof bridge.invoke === "function") {
    return bridge.invoke("external-editors:open-with-other", { path });
  }
  return {
    success: false,
    error: "Opening with another application is not available in this build",
  };
});

/**
 * `external-editors:detect-installed` → `host.listInstalledEditors`, enriched
 * with the shared EDITOR_REGISTRY display metadata (the daemon reports only
 * detection facts: id / installed / path / source / flatpakId). Entries the
 * registry does not know are dropped. Mirrors the feature client's
 * `{ success, data }` envelope; failures fold to `{ success:false, error }` so
 * `fetchEditorsFailure` carries the daemon message.
 */
registerMockIpcHandler(IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED, async () => {
  try {
    const entries = await listInstalledEditors();
    const data: InstalledEditor[] = [];
    for (const entry of entries) {
      const def = EDITOR_REGISTRY.find((candidate) => candidate.id === entry.id);
      if (!def) continue;
      data.push({
        id: def.id,
        name: def.name,
        shortLabel: def.shortLabel,
        appName: def.appName,
        category: def.category,
        handlerType: def.handlerType,
        bundleId: def.bundleId,
        shortcut: def.shortcut,
        priority: def.priority,
        installed: entry.installed === true,
      });
    }
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});
