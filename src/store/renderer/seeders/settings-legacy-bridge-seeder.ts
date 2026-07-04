/**
 * Legacy settings-store bridge — routes the flat electron-store IPC surface
 * (`settings:get` / `settings:set` / `settings:update`, reference
 * system.ipc.ts) to the daemon settings catalog (PROTOCOL §5.12) for the keys
 * the daemon canonically owns, and to namespaced localStorage for the keys
 * PROTOCOL explicitly lists as "Not exposed (FE-only)".
 *
 * Callers are the settings-proposal apply/rollback path
 * (`settings-proposal-actions.ts`, the `settings-ipc` / `settings-update-ipc`
 * apply kinds in app-settings-schema.ts) and the analytics download-attribution
 * read/write (`downloadAttribution`, FE-local). Envelope semantics mirror the
 * reference main handlers: get → `{ success, data }`, set/update →
 * `{ success }`; failures fold to `{ success: false, error }` (the reference
 * `createSafeValidatedHandler` never rejects either).
 *
 * Daemon-owned keys route through `settings.get` / `settings.update`, so a
 * proposal apply lands in the same store the daemon-backed settings panels
 * read (no split-brain with e.g. GitWorkspaceSettings' `git.autoCommit`).
 * `claude-codePath` / `codexPath` are sub-keys of the daemon's
 * `providers.paths` object and use a read-merge-write. Note
 * `workspace.sshKeyPath` is **sensitive** (§5.12): writes land, but reads come
 * back redacted.
 *
 * Also gates the feature-codes surface: activation runs main-side services
 * (featureCodesService + app relaunch) with no daemon arm, and any resolved
 * value would render as a fake "Feature activated!" (the dialog only branches
 * on `status`). A registered handler that THROWS is the only honest terminal
 * state — FeatureCodeDialog catches and shows its failure feedback.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom).
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { FEATURE_CODES_CHANNELS, SETTINGS_CHANNELS } from "$shared/ipc/channels";
import { backendRequest } from "$lib/client/live/backend-transport";

/** Legacy electron-store key → daemon settings-catalog path (settings.rs). */
const DAEMON_SETTING_PATHS: Record<string, string> = {
  auggiePath: "context.auggiePath",
  branchPrefix: "workspace.branchPrefix",
  worktreesLocation: "workspace.worktreesLocation",
  sshKeyPath: "workspace.sshKeyPath",
  defaultShell: "workspace.defaultShell",
  autoFetch: "workspace.autoFetch",
  autoCommit: "git.autoCommit",
  enableUserMcpServers: "mcp.enableUserServers",
  disabledMcpServers: "mcp.disabledServers",
};

/** Legacy per-provider path keys → sub-key of the daemon `providers.paths` object. */
const PROVIDER_PATH_KEYS: Record<string, string> = {
  "claude-codePath": "claude-code",
  codexPath: "codex",
};

/**
 * FE-only keys (PROTOCOL §5.12 "Not exposed (FE-only)": `betaUpdatesEnabled`,
 * `hiddenOpenInEditors`, `rtkEnabled`, `linearIssueFilter`,
 * `downloadAttribution`, …) persist under this localStorage namespace —
 * per-user local preferences, same durability class as the electron-store
 * file the reference main process used.
 */
const LOCAL_STORAGE_PREFIX = "legacy-settings:";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function readLocalValue(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function writeLocalValue(key: string, value: unknown): void {
  const storageKey = `${LOCAL_STORAGE_PREFIX}${key}`;
  if (value === undefined) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

/** Daemon `settings.get` — unwraps `{ path, value, definition }` to the value. */
async function daemonGet(path: string): Promise<unknown> {
  const result = await backendRequest<{ value?: unknown }>("settings.get", { path });
  return result?.value;
}

/** Daemon `settings.update` — single-change batch (validated + atomic BE-side). */
async function daemonUpdate(path: string, value: unknown): Promise<void> {
  await backendRequest("settings.update", { changes: [{ path, value }] });
}

async function getSetting(key: string): Promise<unknown> {
  const daemonPath = DAEMON_SETTING_PATHS[key];
  if (daemonPath) return await daemonGet(daemonPath);
  const providerKey = PROVIDER_PATH_KEYS[key];
  if (providerKey) {
    const paths = await daemonGet("providers.paths");
    return paths && typeof paths === "object"
      ? (paths as Record<string, unknown>)[providerKey]
      : undefined;
  }
  return readLocalValue(key);
}

async function setSetting(key: string, value: unknown): Promise<void> {
  const daemonPath = DAEMON_SETTING_PATHS[key];
  if (daemonPath) {
    await daemonUpdate(daemonPath, value);
    return;
  }
  const providerKey = PROVIDER_PATH_KEYS[key];
  if (providerKey) {
    const current = await daemonGet("providers.paths");
    const merged = {
      ...(current && typeof current === "object" ? (current as Record<string, unknown>) : {}),
      [providerKey]: value,
    };
    await daemonUpdate("providers.paths", merged);
    return;
  }
  writeLocalValue(key, value);
}

registerMockIpcHandler(SETTINGS_CHANNELS.GET, async (arg) => {
  const key = (arg as { key?: unknown } | undefined)?.key;
  if (typeof key !== "string" || !key) {
    return { success: false, error: "settings:get requires a key" };
  }
  try {
    return { success: true, data: await getSetting(key) };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

registerMockIpcHandler(SETTINGS_CHANNELS.SET, async (arg) => {
  const { key, value } = (arg ?? {}) as { key?: unknown; value?: unknown };
  if (typeof key !== "string" || !key) {
    return { success: false, error: "settings:set requires a key" };
  }
  try {
    await setSetting(key, value);
    return { success: true };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

registerMockIpcHandler(SETTINGS_CHANNELS.UPDATE, async (arg) => {
  const settings = (arg as { settings?: unknown } | undefined)?.settings;
  if (!settings || typeof settings !== "object") {
    return { success: false, error: "settings:update requires a settings object" };
  }
  try {
    for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
      await setSetting(key, value);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// Feature-codes gate (see module doc): a resolved value would fake success in
// FeatureCodeDialog, so both handlers throw — the dialog catches `activate`
// into its failure feedback; `restart-app` is unreachable while activation
// is gated (the restart affordance only renders after a successful change).
registerMockIpcHandler(FEATURE_CODES_CHANNELS.ACTIVATE, () => {
  throw new Error("Feature codes are not supported in this build");
});

registerMockIpcHandler(FEATURE_CODES_CHANNELS.RESTART_APP, () => {
  throw new Error("App restart is not available in this build");
});
