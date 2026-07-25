/**
 * Specialists mutation service — the post-saga consumer for the orphaned
 * specialist write actions: `saveFileSpecialist`, `deleteFileSpecialist`,
 * `exportBuiltinToFile`, and `loadFileSpecialists`.
 *
 * These triggers lost their handlers when the saga runtime was removed, so
 * specialist changes from Settings (model override for all specialists, per-
 * specialist prompt edits, create-new, delete, reset-to-default) produced no
 * wire call and the button/form stayed visible/stale until the app restarted.
 * This restores the write path WITHOUT re-adding a saga and WITHOUT changing
 * any dispatch site: `createSpecialistsMutationMiddleware()` observes
 * dispatched actions and services each trigger by calling the
 * `appClient.specialists` seam, refetching `specialist.list`, and dispatching
 * the result back to the store so derived UI (the "Use for all specialists"
 * button hiding) reacts.
 *
 * Save chooses `specialist.create` vs `.edit` by checking whether a file
 * specialist already exists in store state (daemon semantics: create errors on
 * existing id, edit errors on missing id). Delete calls `specialist.delete`.
 * Export reads the bundled definition and saves it as a user file. Load
 * refetches the list and dispatches the bundled/file split. On failure: surface
 * an error toast (lazy-import) — do not fail silently.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, the slice actions/types, collection utils, and the
 * logger. No selector modules (importing them would evaluate
 * `store.createSelector` during middleware-chain construction); state is read
 * directly off `appStore.state.specialists`.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import type { SpecialistDef } from "$lib/client/app-client";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  saveFileSpecialist,
  deleteFileSpecialist,
  exportBuiltinToFile,
  loadFileSpecialists,
  setBundledSpecialists,
  setFileSpecialists,
  setBundledSpecialistsLoaded,
  setFileSpecialistsLoaded,
  setOverridesLoaded,
  setCustomSpecialistsLoaded,
  type FileSpecialist,
} from "$store/renderer/slices/specialists/specialists-slice";
import { SPECIALISTS } from "$lib/constants/specialists";
import type { ModelTier, SpecialistFileScope } from "$shared/specialist-file-types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("SpecialistsMutationService");

/** Lazily pull the toast lib so this middleware-reachable module stays light. */
async function getToast() {
  const { toast } = await import("svelte-sonner");
  return toast;
}

function errorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  return error instanceof Error ? error.message : String(error);
}

/** Direct one-time read of fileSpecialists state (dependency-light, no selector import). */
function readFileSpecialist(id: string): FileSpecialist | undefined {
  const state = appStore.state as {
    specialists?: { fileSpecialists: { map: Record<string, FileSpecialist> } };
  };
  return state.specialists?.fileSpecialists.map[id];
}

/** Direct one-time read of bundledSpecialists state (dependency-light, no selector import). */
function readBundledSpecialist(id: string): typeof SPECIALISTS[number] | undefined {
  const state = appStore.state as { specialists?: { bundledSpecialists: typeof SPECIALISTS } };
  const bundled = state.specialists?.bundledSpecialists;
  // Before the initial specialist.list load populates the store, fall back to
  // the static constant so built-in flags (e.g. `hidden`) are never dropped.
  return (bundled?.length ? bundled : SPECIALISTS).find((s) => s.id === id);
}

const MODEL_TIERS = new Set<ModelTier>(["fast", "balanced", "smart"]);

function toModelTier(value: string | undefined): ModelTier | undefined {
  return value !== undefined && MODEL_TIERS.has(value as ModelTier) ? (value as ModelTier) : undefined;
}

/** Map a bundled-tier wire `SpecialistDef` (PROTOCOL §5.11) to the store's `Specialist`. */
function toBundledSpecialist(def: SpecialistDef): typeof SPECIALISTS[number] {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    codingAgent: def.codingAgent,
    defaultModel: def.model,
    defaultModelTier: toModelTier(def.modelTier),
    defaultBehaviorPrompt: def.behaviorPrompt ?? def.prompt ?? "",
    roleReminder: def.roleReminder,
    source: "bundled" as const,
    defaultAgentType: def.agentType,
    hidden: def.hidden,
  };
}

/** Map a user/project-tier wire `SpecialistDef` to the store's `FileSpecialist`. */
function toFileSpecialist(def: SpecialistDef): FileSpecialist {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    codingAgent: def.codingAgent,
    model: def.model ?? "",
    modelTier: toModelTier(def.modelTier),
    behaviorPrompt: def.behaviorPrompt ?? def.prompt ?? "",
    roleReminder: def.roleReminder,
    filePath: def.path ?? "",
    source: def.source as SpecialistFileScope,
    hidden: def.hidden,
  };
}

/**
 * Dispatch a `specialist.list` result to the store as the bundled/file split.
 *
 * CRITICAL: The daemon returns tier-merged results where user files SHADOW bundled
 * definitions (higher tier wins per ID). When any ID has a user file, it comes back
 * with source="user" ONLY — its bundled definition is absent from the response.
 * To preserve all built-in identities regardless of which IDs currently have user
 * overrides, the bundled set must be reconstructed from the SPECIALISTS constant
 * (authoritative list of all built-ins) overlaid with any daemon-returned bundled
 * entries (in case the daemon adds new bundled specialists in the future).
 *
 * Exported so the live `specialists:changed` subscription
 * (`specialists-list-subscription.ts`) routes daemon-driven refetches through
 * the same split as the post-write refetch below.
 */
export function dispatchSpecialistList(defs: SpecialistDef[]): void {
  const bundledDefs = defs.filter((def) => def.source === "bundled");
  const fileDefs = defs.filter((def) => def.source === "user" || def.source === "project");

  // Reconstruct the bundled set: start with SPECIALISTS (all built-ins), then
  // overlay daemon-returned bundled entries by ID (in case new bundled specialists
  // are added). This ensures that built-in IDs shadowed by user files (which come
  // back as source="user" and are absent from bundledDefs) retain their bundled
  // identity in the store.
  const bundledById = new Map(bundledDefs.map((def) => [def.id, toBundledSpecialist(def)]));
  const reconstructedBundled = SPECIALISTS.map((builtin) => {
    const fromDaemon = bundledById.get(builtin.id);
    if (fromDaemon) {
      return fromDaemon;
    }
    // The SPECIALISTS constant entry doesn't have source="bundled" set, but we
    // know it's bundled. Ensure source is set for store consumers (e.g., UI source labels).
    return { ...builtin, source: "bundled" as const };
  });

  // Add any daemon-returned bundled IDs not in SPECIALISTS (future-proof if the
  // daemon adds new bundled specialists).
  const builtinIds = new Set(SPECIALISTS.map((s) => s.id));
  for (const def of bundledDefs) {
    if (!builtinIds.has(def.id)) {
      reconstructedBundled.push(toBundledSpecialist(def));
    }
  }

  appStore.dispatch(setBundledSpecialists(reconstructedBundled));
  appStore.dispatch(setBundledSpecialistsLoaded(true));
  appStore.dispatch(setOverridesLoaded(true));
  appStore.dispatch(setCustomSpecialistsLoaded(true));
  appStore.dispatch(setFileSpecialists(fileDefs.map(toFileSpecialist)));
  appStore.dispatch(setFileSpecialistsLoaded(true));
}

/** Refetch `specialist.list` and dispatch the bundled/file split. */
async function refetchAndDispatch(): Promise<void> {
  try {
    const defs = await appClient.specialists.list();
    dispatchSpecialistList(defs);
  } catch (error) {
    logger.error("Failed to refetch specialist list", error);
    const { toast } = await import("$lib/components/ui/toast");
    toast.error("Failed to refresh specialists list after write");
  }
}

async function handleSaveFileSpecialist(
  action: ReturnType<typeof saveFileSpecialist>,
): Promise<void> {
  const [payload] = action.payload;
  try {
    const existing = readFileSpecialist(payload.id);
    // Carry `hidden` from the current resolved specialist (file override →
    // bundled) so a user-tier override of a hidden specialist (e.g.
    // chief-of-staff) does not resurface it in pickers.
    const hidden = existing?.hidden ?? readBundledSpecialist(payload.id)?.hidden;
    const spec: SpecialistDef = {
      id: payload.id,
      name: payload.name,
      description: payload.description,
      codingAgent: payload.codingAgent,
      model: payload.model,
      modelTier: payload.modelTier,
      roleReminder: payload.roleReminder,
      behaviorPrompt: payload.behaviorPrompt,
      source: (payload.scope ?? "user") as "user" | "project",
      hidden,
    };
    const scope = payload.scope ?? "user";
    if (existing) {
      await appClient.specialists.edit(payload.id, spec, scope, payload.workspacePath);
    } else {
      await appClient.specialists.create(payload.id, spec, scope, payload.workspacePath);
    }
    await refetchAndDispatch();
  } catch (error) {
    logger.error("Failed to save file specialist", error);
    const toast = await getToast();
    toast.error(errorMessage(error, "Failed to save specialist"));
  }
}

async function handleDeleteFileSpecialist(
  action: ReturnType<typeof deleteFileSpecialist>,
): Promise<void> {
  const [ref] = action.payload;
  try {
    const scope = ref.scope ?? "user";
    await appClient.specialists.delete(ref.id, scope, ref.workspacePath);
    await refetchAndDispatch();
  } catch (error) {
    logger.error("Failed to delete file specialist", error);
    const toast = await getToast();
    toast.error(errorMessage(error, "Failed to delete specialist"));
  }
}

async function handleExportBuiltinToFile(
  action: ReturnType<typeof exportBuiltinToFile>,
): Promise<void> {
  const [specialistId] = action.payload;
  try {
    const bundled = readBundledSpecialist(specialistId);
    if (!bundled) {
      throw new Error(`Bundled specialist not found: ${specialistId}`);
    }
    const spec: SpecialistDef = {
      id: bundled.id,
      name: bundled.name,
      description: bundled.description,
      codingAgent: bundled.codingAgent,
      model: bundled.defaultModel,
      modelTier: bundled.defaultModelTier,
      roleReminder: bundled.roleReminder,
      behaviorPrompt: bundled.defaultBehaviorPrompt,
      source: "user",
      hidden: bundled.hidden,
    };
    await appClient.specialists.create(bundled.id, spec, "user");
    await refetchAndDispatch();
  } catch (error) {
    logger.error("Failed to export bundled specialist to file", error);
    const toast = await getToast();
    toast.error(errorMessage(error, "Failed to export specialist"));
  }
}

async function handleLoadFileSpecialists(): Promise<void> {
  await refetchAndDispatch();
}

/**
 * Middleware giving the specialist slice's write actions a real handler.
 * After each write succeeds, refetch `specialist.list` and update the store so
 * derived UI (the "Use for all specialists" button hiding) reacts.
 */
export function createSpecialistsMutationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof action !== "object") return result;
    const type = (action as { type?: unknown }).type;
    switch (type) {
      case saveFileSpecialist.type:
        void handleSaveFileSpecialist(action as ReturnType<typeof saveFileSpecialist>);
        break;
      case deleteFileSpecialist.type:
        void handleDeleteFileSpecialist(action as ReturnType<typeof deleteFileSpecialist>);
        break;
      case exportBuiltinToFile.type:
        void handleExportBuiltinToFile(action as ReturnType<typeof exportBuiltinToFile>);
        break;
      case loadFileSpecialists.type:
        void handleLoadFileSpecialists();
        break;
    }
    return result;
  };
}
