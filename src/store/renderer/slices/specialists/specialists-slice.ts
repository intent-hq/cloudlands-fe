import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import {
  addItem,
  createCollection,
  removeItem,
  updateItem,
  type Collection,
} from "ag-redux-toolkit/utils/collections/collection-utils";
import type { ModelTier, SpecialistFileScope } from "$shared/specialist-file-types";

// ============================================================================
// Types (re-exported for consumers)
// ============================================================================

export interface SpecialistOverrides {
  codingAgentOverrides: Record<string, string>;
  modelOverrides: Record<string, string>;
  behaviorPromptOverrides: Record<string, string>;
}

export interface CustomSpecialist {
  id: string;
  name: string;
  description: string;
  codingAgent?: string;
  model: string;
  behaviorPrompt: string;
  roleReminder?: string;
}

export interface FileSpecialist {
  id: string;
  name: string;
  description: string;
  codingAgent?: string;
  model: string;
  modelTier?: ModelTier;
  behaviorPrompt: string;
  roleReminder?: string;
  filePath: string;
  source: SpecialistFileScope;
}

export interface FileSpecialistWritePayload {
  id: string;
  name: string;
  description: string;
  codingAgent?: string;
  model?: string;
  modelTier?: ModelTier;
  roleReminder?: string;
  behaviorPrompt: string;
  scope?: SpecialistFileScope;
  workspacePath?: string;
}

export interface FileSpecialistReference {
  id: string;
  scope?: SpecialistFileScope;
  workspacePath?: string;
}

// ============================================================================
// State
// ============================================================================

export type SpecialistsState = {
  bundledSpecialists: import('$lib/constants/specialists').Specialist[];
  customSpecialists: Collection<CustomSpecialist, "id">;
  fileSpecialists: Collection<FileSpecialist, "id">;
  userOverrides: SpecialistOverrides;
  providerModelOverrides: Record<string, Record<string, string>>;
  overridesLoaded: boolean;
  customSpecialistsLoaded: boolean;
  fileSpecialistsLoaded: boolean;
  bundledSpecialistsLoaded: boolean;
  specialistsFolderPath: string | null;
};

// ============================================================================
// Constants
// ============================================================================

export const SPECIALISTS_OVERRIDES_KEY = 'specialists-overrides';
export const CUSTOM_SPECIALISTS_KEY = 'custom-specialists';
export const PROVIDER_MODEL_OVERRIDES_KEY = 'specialists-model-overrides-per-provider';

// ============================================================================
// Initial State
// ============================================================================

export const initialState: SpecialistsState = {
  bundledSpecialists: [],
  customSpecialists: createCollection<CustomSpecialist, "id">("id"),
  fileSpecialists: createCollection<FileSpecialist, "id">("id"),
  userOverrides: {
    codingAgentOverrides: {},
    modelOverrides: {},
    behaviorPromptOverrides: {},
  },
  providerModelOverrides: {},
  overridesLoaded: false,
  customSpecialistsLoaded: false,
  fileSpecialistsLoaded: false,
  bundledSpecialistsLoaded: false,
  specialistsFolderPath: null,
};

// ============================================================================
// Reducer Actions (pure state updates)
// ============================================================================

export const setBundledSpecialists = createAction<[specialists: import('$lib/constants/specialists').Specialist[]]>("specialists/setBundledSpecialists");
export const setCustomSpecialists = createAction<[specialists: CustomSpecialist[]]>("specialists/setCustomSpecialists");
export const setFileSpecialists = createAction<[specialists: FileSpecialist[]]>("specialists/setFileSpecialists");
export const setUserOverrides = createAction<[overrides: SpecialistOverrides]>("specialists/setUserOverrides");
export const setOverridesLoaded = createAction<[loaded: boolean]>("specialists/setOverridesLoaded");
export const setCustomSpecialistsLoaded = createAction<[loaded: boolean]>("specialists/setCustomSpecialistsLoaded");
export const setFileSpecialistsLoaded = createAction<[loaded: boolean]>("specialists/setFileSpecialistsLoaded");
export const setBundledSpecialistsLoaded = createAction<[loaded: boolean]>("specialists/setBundledSpecialistsLoaded");
export const setSpecialistsFolderPath = createAction<[path: string | null]>("specialists/setSpecialistsFolderPath");
export const setProviderModelOverrides = createAction<[overrides: Record<string, Record<string, string>>]>("specialists/setProviderModelOverrides");

// ── DEPRECATED (Wave 2) ───────────────────────────────────────────────
// Override actions are deprecated. Overrides are now persisted as user
// specialist files (~/.augment/specialists/{id}.md) via saveFileSpecialist.
// These actions still update in-memory state for backward compatibility
// but are no longer persisted to electron-store.
/** @deprecated Use saveFileSpecialist instead */
export const setModelOverride = createAction<[specialistId: string, model: string]>("specialists/setModelOverride");
/** @deprecated Use deleteFileSpecialist to reset to bundled */
export const clearModelOverride = createAction<[specialistId: string]>("specialists/clearModelOverride");
/** @deprecated Use saveFileSpecialist for each specialist instead */
export const setBulkModelOverrides = createAction<[overrides: Record<string, string>]>("specialists/setBulkModelOverrides");
/** @deprecated Use saveFileSpecialist instead */
export const setBehaviorPromptOverride = createAction<[specialistId: string, prompt: string]>("specialists/setBehaviorPromptOverride");
/** @deprecated Use deleteFileSpecialist to reset to bundled */
export const clearBehaviorPromptOverride = createAction<[specialistId: string]>("specialists/clearBehaviorPromptOverride");
/** @deprecated Use saveFileSpecialist instead */
export const setCodingAgentOverride = createAction<[specialistId: string, codingAgent: string]>("specialists/setCodingAgentOverride");
/** @deprecated Use deleteFileSpecialist to reset to bundled */
export const clearCodingAgentOverride = createAction<[specialistId: string]>("specialists/clearCodingAgentOverride");
/** @deprecated Use deleteFileSpecialist to reset to bundled */
export const clearAllOverrides = createAction<[specialistId: string]>("specialists/clearAllOverrides");
/** @deprecated Use deleteFileSpecialist to reset to bundled */
export const resetAllOverrides = createAction("specialists/resetAllOverrides");

// ── DEPRECATED (Wave 2): Custom specialist actions ────────────────────
// Custom specialists are now created/updated/deleted via file-based
// actions (saveFileSpecialist, deleteFileSpecialist). These are kept
// for the reducer but no UI code should dispatch them.
/** @deprecated Use saveFileSpecialist instead */
export const createCustomSpecialist = createAction<[specialist: Omit<CustomSpecialist, 'id'>], [specialist: Omit<CustomSpecialist, 'id'>, id: string]>(
  "specialists/createCustomSpecialist",
  (specialist) => [specialist, `custom-${Date.now()}`]
);
/** @deprecated Use saveFileSpecialist instead */
export const updateCustomSpecialist = createAction<[specialistId: string, updates: Partial<Omit<CustomSpecialist, 'id'>>]>("specialists/updateCustomSpecialist");
/** @deprecated Use deleteFileSpecialist instead */
export const deleteCustomSpecialist = createAction<[specialistId: string]>("specialists/deleteCustomSpecialist");

// Saga trigger actions
export const switchModelOverridesForProvider = createAction<[newProviderId: string, previousProviderId: string]>("specialists/switchModelOverridesForProvider");
export const exportBuiltinToFile = createAction<[specialistId: string]>("specialists/exportBuiltinToFile");
export const saveFileSpecialist = createAction<[specialist: FileSpecialistWritePayload]>("specialists/saveFileSpecialist");
export const deleteFileSpecialist = createAction<[specialist: FileSpecialistReference]>("specialists/deleteFileSpecialist");
export const openSpecialistsFolder = createAction("specialists/openSpecialistsFolder");
export const loadFileSpecialists = createAction("specialists/loadFileSpecialists");


// ============================================================================
// Reducer
// ============================================================================

export const specialistsReducer = createReducer<SpecialistsState>(initialState)
  .with(setBundledSpecialists, (state, { payload: [specialists] }) => ({
    ...state,
    bundledSpecialists: specialists,
  }))
  .with(setCustomSpecialists, (state, { payload: [specialists] }) => ({
    ...state,
    customSpecialists: createCollection<CustomSpecialist, "id">("id", specialists),
  }))
  .with(setFileSpecialists, (state, { payload: [specialists] }) => ({
    ...state,
    fileSpecialists: createCollection<FileSpecialist, "id">("id", specialists),
  }))
  .with(setUserOverrides, (state, { payload: [overrides] }) => ({
    ...state,
    userOverrides: {
      codingAgentOverrides: overrides.codingAgentOverrides ?? {},
      modelOverrides: overrides.modelOverrides ?? {},
      behaviorPromptOverrides: overrides.behaviorPromptOverrides ?? {},
    },
  }))
  .with(setOverridesLoaded, (state, { payload: [loaded] }) => ({
    ...state,
    overridesLoaded: loaded,
  }))
  .with(setCustomSpecialistsLoaded, (state, { payload: [loaded] }) => ({
    ...state,
    customSpecialistsLoaded: loaded,
  }))
  .with(setFileSpecialistsLoaded, (state, { payload: [loaded] }) => ({
    ...state,
    fileSpecialistsLoaded: loaded,
  }))
  .with(setBundledSpecialistsLoaded, (state, { payload: [loaded] }) => ({
    ...state,
    bundledSpecialistsLoaded: loaded,
  }))
  .with(setSpecialistsFolderPath, (state, { payload: [path] }) => ({
    ...state,
    specialistsFolderPath: path,
  }))
  .with(setProviderModelOverrides, (state, { payload: [overrides] }) => ({
    ...state,
    providerModelOverrides: overrides,
  }))
  .with(setModelOverride, (state, { payload: [specialistId, model] }) => ({
    ...state,
    userOverrides: {
      ...state.userOverrides,
      modelOverrides: { ...state.userOverrides.modelOverrides, [specialistId]: model },
    },
  }))
  .with(clearModelOverride, (state, { payload: [specialistId] }) => {
     
    const { [specialistId]: _, ...rest } = state.userOverrides.modelOverrides;
    return {
      ...state,
      userOverrides: { ...state.userOverrides, modelOverrides: rest },
    };
  })
  .with(setBulkModelOverrides, (state, { payload: [overrides] }) => ({
    ...state,
    userOverrides: {
      ...state.userOverrides,
      modelOverrides: { ...state.userOverrides.modelOverrides, ...overrides },
    },
  }))
  .with(setBehaviorPromptOverride, (state, { payload: [specialistId, prompt] }) => ({
    ...state,
    userOverrides: {
      ...state.userOverrides,
      behaviorPromptOverrides: { ...state.userOverrides.behaviorPromptOverrides, [specialistId]: prompt },
    },
  }))
  .with(clearBehaviorPromptOverride, (state, { payload: [specialistId] }) => {
     
    const { [specialistId]: _, ...rest } = state.userOverrides.behaviorPromptOverrides;
    return {
      ...state,
      userOverrides: { ...state.userOverrides, behaviorPromptOverrides: rest },
    };
  })
  .with(setCodingAgentOverride, (state, { payload: [specialistId, codingAgent] }) => ({
    ...state,
    userOverrides: {
      ...state.userOverrides,
      codingAgentOverrides: { ...state.userOverrides.codingAgentOverrides, [specialistId]: codingAgent },
    },
  }))
  .with(clearCodingAgentOverride, (state, { payload: [specialistId] }) => {
     
    const { [specialistId]: _, ...rest } = state.userOverrides.codingAgentOverrides;
    return {
      ...state,
      userOverrides: { ...state.userOverrides, codingAgentOverrides: rest },
    };
  })
  .with(clearAllOverrides, (state, { payload: [specialistId] }) => {
     
    const { [specialistId]: _c, ...codingAgentRest } = state.userOverrides.codingAgentOverrides;
     
    const { [specialistId]: _m, ...modelRest } = state.userOverrides.modelOverrides;
     
    const { [specialistId]: _b, ...behaviorRest } = state.userOverrides.behaviorPromptOverrides;
    return {
      ...state,
      userOverrides: { codingAgentOverrides: codingAgentRest, modelOverrides: modelRest, behaviorPromptOverrides: behaviorRest },
    };
  })
  .with(resetAllOverrides, (state) => ({
    ...state,
    userOverrides: { codingAgentOverrides: {}, modelOverrides: {}, behaviorPromptOverrides: {} },
  }))
  .with(createCustomSpecialist, (state, { payload: [specialist, id] }) => {
    const newSpecialist: CustomSpecialist = { id, ...specialist };
    return {
      ...state,
      customSpecialists: addItem(state.customSpecialists, newSpecialist),
    };
  })
  .with(updateCustomSpecialist, (state, { payload: [specialistId, updates] }) => {
    const customSpecialists = updateItem(state.customSpecialists, { id: specialistId, ...updates });
    if (customSpecialists === state.customSpecialists) {
      return state;
    }
    return { ...state, customSpecialists };
  })
  .with(deleteCustomSpecialist, (state, { payload: [specialistId] }) => {
    const customSpecialists = removeItem(state.customSpecialists, specialistId);
    if (customSpecialists === state.customSpecialists) {
      return state;
    }
    return {
      ...state,
      customSpecialists,
    };
  });

