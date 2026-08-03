import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import {
  AGENT_KEY_COUNT,
  keyPinsEqual,
  normalizeExcludedWorkspaceIds,
  normalizeKeyPins,
  UNASSIGNED_KEY_PIN,
} from "$features/hardware-console/assignment/key-assignment";
import {
  clampPromptPickerLimit,
  DEFAULT_PROMPT_PICKER_LIMIT,
  recordPromptUsage as applyPromptUsage,
  type PromptUsageEntry,
} from "$features/hardware-console/prompt-picker/curation";
import {
  normalizeActionMapping,
  normalizeActionMappingsByModel,
  type ActionKeyActionId,
} from "$features/hardware-console/actions/action-mapping";
import {
  normalizeCycleScopeByFamily,
  type CycleScope,
  type CycleScopeFamilyId,
} from "$features/hardware-console/actions/cycle-scope";
import type { HardwareDeviceModel } from "$features/hardware-console/input/types";
import type {
  HardwareConsoleState,
  RadialPromptPickerState,
} from "./hardware-console-types";

const closedRadialPrompt: RadialPromptPickerState = { open: false, prompts: [], sector: null };

export const initialState: HardwareConsoleState = {
  enabled: true,
  enabledHydrated: false,
  keyPins: new Array<string | null>(AGENT_KEY_COUNT).fill(null),
  hydrated: false,
  excludedWorkspaceIds: [],
  promptUsage: [],
  promptPickerLimit: DEFAULT_PROMPT_PICKER_LIMIT,
  promptsHydrated: false,
  radialPrompt: closedRadialPrompt,
  encoderHudWorkspaceId: null,
  actionMappingByModel: normalizeActionMappingsByModel(undefined),
  actionMappingHydrated: false,
  cycleScopeByFamily: normalizeCycleScopeByFamily(undefined),
};

/** Boot-time hydration from the `hardwareConsole.state` daemon settings bag. */
export const hydrateHardwareConsoleKeyPins = createAction<
  [keyPins: (string | null)[], excludedWorkspaceIds?: string[]]
>("hardwareConsole/hydrateKeyPins");
/**
 * Sticky write-back from the persistence middleware: auto-filled slots
 * promoted into pins / vanished workspaces released (see `reconcileKeyPins`
 * in `$features/hardware-console/assignment/key-assignment`). The
 * middleware persists the reconciled array itself.
 */
export const keyPinsReconciled = createAction<[keyPins: (string | null)[]]>(
  "hardwareConsole/keyPinsReconciled",
);
/** Boot-time hydration of the integration-enabled flag from the daemon settings bag. */
export const hydrateHardwareConsoleEnabled = createAction<[enabled: boolean]>(
  "hardwareConsole/hydrateEnabled",
);
/** Enable/disable the hardware-console integration (device panel toggle). */
export const setHardwareConsoleEnabled = createAction<[enabled: boolean]>(
  "hardwareConsole/setEnabled",
);
/** Set the radial picker's top-N surface (device panel setting; clamped 1–12). */
export const setPromptPickerLimit = createAction<[limit: number]>(
  "hardwareConsole/setPromptPickerLimit",
);
/**
 * Pin a workspace to an agent-key slot (0-based). Clears the workspace from
 * any other slot and from the auto-fill exclusion list.
 */
export const pinWorkspaceToKey = createAction<[slot: number, workspaceId: string]>(
  "hardwareConsole/pinWorkspaceToKey",
);
/**
 * Remove a workspace's pin from whichever slot holds it and exclude it from
 * future auto-fill (unassign = exclude; re-pinning clears the exclusion).
 */
export const unpinWorkspaceFromKeys = createAction<[workspaceId: string]>(
  "hardwareConsole/unpinWorkspaceFromKeys",
);
/**
 * Mark a slot sticky-unassigned (0-based): it stays empty and never
 * auto-fills. The evicted workspace (if any) joins the exclusion list.
 */
export const markKeySlotUnassigned = createAction<[slot: number]>(
  "hardwareConsole/markKeySlotUnassigned",
);
/** Boot-time hydration of the prompt tracker + picker limit from the daemon settings bag. */
export const hydrateHardwareConsolePrompts = createAction<
  [promptUsage: PromptUsageEntry[], promptPickerLimit: number]
>("hardwareConsole/hydratePrompts");
/** Record one composer submission in the prompt-usage tracker. */
export const promptUsageRecorded = createAction(
  "hardwareConsole/promptUsageRecorded",
  (text: string, timestamp = Date.now()) => ({
    text,
    atIso: new Date(timestamp).toISOString(),
  }),
);
/** Joystick deflected past the dead-zone: open the radial picker overlay. */
export const radialPromptPickerOpened = createAction<
  [prompts: string[], sector: number | null]
>("hardwareConsole/radialPromptPickerOpened");
/** Joystick moved to another sector (`null` = centered, release cancels). */
export const radialPromptPickerSectorChanged = createAction<[sector: number | null]>(
  "hardwareConsole/radialPromptPickerSectorChanged",
);
/** Joystick released (or device disconnected): close the overlay. */
export const radialPromptPickerClosed = createAction(
  "hardwareConsole/radialPromptPickerClosed",
);
/** Encoder rotation targeted a workspace: show the small cycling HUD. */
export const encoderHudShown = createAction<[workspaceId: string]>(
  "hardwareConsole/encoderHudShown",
);
/** Cycling HUD timed out (or device disconnected): hide it. */
export const encoderHudHidden = createAction("hardwareConsole/encoderHudHidden");
/** Boot-time hydration of the per-model action-key mappings from the daemon settings bag. */
export const hydrateHardwareConsoleActionMapping = createAction<
  [actionMappingByModel: Partial<Record<HardwareDeviceModel, ActionKeyActionId[]>>]
>("hardwareConsole/hydrateActionMapping");
/** Assign an action to a model's action-key slot (0-based; `none` = unassigned). */
export const setActionKeyMapping = createAction<
  [model: HardwareDeviceModel, slot: number, actionId: ActionKeyActionId]
>("hardwareConsole/setActionKeyMapping");
/** Boot-time hydration of the per-family cycle scopes from the daemon settings bag. */
export const hydrateHardwareConsoleCycleScopes = createAction<
  [cycleScopeByFamily: Partial<Record<CycleScopeFamilyId, CycleScope>>]
>("hardwareConsole/hydrateCycleScopes");
/** Set one cycle family's scope (Settings checkbox: include sub-agents or not). */
export const setCycleScope = createAction<
  [familyId: CycleScopeFamilyId, scope: CycleScope]
>("hardwareConsole/setCycleScope");

function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < AGENT_KEY_COUNT;
}

export const hardwareConsoleReducer = createReducer<HardwareConsoleState>(initialState)
  .with(hydrateHardwareConsoleKeyPins, (state, { payload: [keyPins, excludedWorkspaceIds] }) => {
    return {
      ...state,
      keyPins: normalizeKeyPins(keyPins),
      excludedWorkspaceIds: normalizeExcludedWorkspaceIds(excludedWorkspaceIds),
      hydrated: true,
    };
  })
  .with(keyPinsReconciled, (state, { payload: [keyPins] }) => {
    const normalized = normalizeKeyPins(keyPins);
    if (keyPinsEqual(state.keyPins, normalized)) return state;
    return { ...state, keyPins: normalized };
  })
  .with(hydrateHardwareConsoleEnabled, (state, { payload: [enabled] }) => {
    return { ...state, enabled: enabled !== false, enabledHydrated: true };
  })
  .with(setHardwareConsoleEnabled, (state, { payload: [enabled] }) => {
    if (state.enabled === enabled) return state;
    return { ...state, enabled };
  })
  .with(setPromptPickerLimit, (state, { payload: [limit] }) => {
    const promptPickerLimit = clampPromptPickerLimit(limit);
    if (state.promptPickerLimit === promptPickerLimit) return state;
    return { ...state, promptPickerLimit };
  })
  .with(pinWorkspaceToKey, (state, { payload: [slot, workspaceId] }) => {
    if (!isValidSlot(slot) || !workspaceId) return state;
    const excludedWorkspaceIds = state.excludedWorkspaceIds.includes(workspaceId)
      ? state.excludedWorkspaceIds.filter((id) => id !== workspaceId)
      : state.excludedWorkspaceIds;
    if (state.keyPins[slot] === workspaceId) {
      if (excludedWorkspaceIds === state.excludedWorkspaceIds) return state;
      return { ...state, excludedWorkspaceIds };
    }
    const keyPins = state.keyPins.map((pin) => (pin === workspaceId ? null : pin));
    keyPins[slot] = workspaceId;
    return { ...state, keyPins, excludedWorkspaceIds };
  })
  .with(unpinWorkspaceFromKeys, (state, { payload: [workspaceId] }) => {
    if (!workspaceId) return state;
    const pinned = state.keyPins.includes(workspaceId);
    const excluded = state.excludedWorkspaceIds.includes(workspaceId);
    if (!pinned && excluded) return state;
    const keyPins = pinned
      ? state.keyPins.map((pin) => (pin === workspaceId ? null : pin))
      : state.keyPins;
    const excludedWorkspaceIds = excluded
      ? state.excludedWorkspaceIds
      : [...state.excludedWorkspaceIds, workspaceId];
    return { ...state, keyPins, excludedWorkspaceIds };
  })
  .with(markKeySlotUnassigned, (state, { payload: [slot] }) => {
    if (!isValidSlot(slot) || state.keyPins[slot] === UNASSIGNED_KEY_PIN) return state;
    const evicted = state.keyPins[slot];
    const keyPins = state.keyPins.slice();
    keyPins[slot] = UNASSIGNED_KEY_PIN;
    const excludedWorkspaceIds =
      evicted !== null && !state.excludedWorkspaceIds.includes(evicted)
        ? [...state.excludedWorkspaceIds, evicted]
        : state.excludedWorkspaceIds;
    return { ...state, keyPins, excludedWorkspaceIds };
  })
  .with(hydrateHardwareConsolePrompts, (state, { payload: [promptUsage, promptPickerLimit] }) => {
    return {
      ...state,
      promptUsage,
      promptPickerLimit: clampPromptPickerLimit(promptPickerLimit),
      promptsHydrated: true,
    };
  })
  .with(promptUsageRecorded, (state, { payload: { text, atIso } }) => {
    const promptUsage = applyPromptUsage(state.promptUsage, text, atIso);
    return promptUsage === null ? state : { ...state, promptUsage };
  })
  .with(radialPromptPickerOpened, (state, { payload: [prompts, sector] }) => {
    return { ...state, radialPrompt: { open: true, prompts, sector } };
  })
  .with(radialPromptPickerSectorChanged, (state, { payload: [sector] }) => {
    if (!state.radialPrompt.open || state.radialPrompt.sector === sector) return state;
    return { ...state, radialPrompt: { ...state.radialPrompt, sector } };
  })
  .with(radialPromptPickerClosed, (state) => {
    if (!state.radialPrompt.open) return state;
    return { ...state, radialPrompt: closedRadialPrompt };
  })
  .with(encoderHudShown, (state, { payload: [workspaceId] }) => {
    if (!workspaceId || state.encoderHudWorkspaceId === workspaceId) return state;
    return { ...state, encoderHudWorkspaceId: workspaceId };
  })
  .with(encoderHudHidden, (state) => {
    if (state.encoderHudWorkspaceId === null) return state;
    return { ...state, encoderHudWorkspaceId: null };
  })
  .with(hydrateHardwareConsoleActionMapping, (state, { payload: [actionMappingByModel] }) => {
    return {
      ...state,
      actionMappingByModel: normalizeActionMappingsByModel(actionMappingByModel),
      actionMappingHydrated: true,
    };
  })
  .with(setActionKeyMapping, (state, { payload: [model, slot, actionId] }) => {
    const current = state.actionMappingByModel[model];
    if (!current) return state;
    if (!Number.isInteger(slot) || slot < 0 || slot >= current.length) return state;
    if (current[slot] === actionId) return state;
    const actionMapping = current.slice();
    actionMapping[slot] = actionId;
    const normalized = normalizeActionMapping(actionMapping, model);
    if (normalized[slot] === current[slot]) return state;
    return {
      ...state,
      actionMappingByModel: { ...state.actionMappingByModel, [model]: normalized },
    };
  })
  .with(hydrateHardwareConsoleCycleScopes, (state, { payload: [cycleScopeByFamily] }) => {
    return { ...state, cycleScopeByFamily: normalizeCycleScopeByFamily(cycleScopeByFamily) };
  })
  .with(setCycleScope, (state, { payload: [familyId, scope] }) => {
    if (state.cycleScopeByFamily[familyId] === undefined) return state;
    if (state.cycleScopeByFamily[familyId] === scope) return state;
    return {
      ...state,
      cycleScopeByFamily: { ...state.cycleScopeByFamily, [familyId]: scope },
    };
  });
