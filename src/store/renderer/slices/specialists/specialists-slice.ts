import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type {
  SpecialistFileScope,
  SpecialistModelOption,
  SpecialistRole,
} from '$shared/specialist-file-types';

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
  behaviorPrompt: string;
  roleReminder?: string;
  filePath: string;
  source: SpecialistFileScope;
  /** When true, excluded from picker surfaces (Settings still shows it). */
  hidden?: boolean;
  /**
   * Ordered delegation model options (PROTOCOL §5.11 `modelOptions`).
   * Undefined when the wire omitted the key (resolved list empty/inherited).
   */
  modelOptions?: SpecialistModelOption[];
  /** Explicit reasoning-effort level; omitted when inheriting the model default. */
  reasoningEffort?: string;
  /**
   * Daemon-computed default-model preview (`specialist.list` resolvedModel/
   * resolvedProvider, PROTOCOL §5.11). Absent when resolution yields the
   * provider CLI default ("Provider default").
   */
  resolvedModel?: string;
  resolvedProvider?: string;
  /**
   * Orchestration role (PROTOCOL §5.11 `role`): 'orchestrator' powers the
   * New Workspace modal's team card; 'internal' is excluded from the modal's
   * single-agent dropdown only. Undefined for standard specialists.
   */
  role?: SpecialistRole;
  /** Specialist ids the orchestrator delegates to (advisory/render-only). */
  teamAgents?: string[];
  /** Built-in avatar design id; unknown/absent degrades to the fallback. */
  icon?: string;
}

export interface FileSpecialistWritePayload {
  id: string;
  name: string;
  description: string;
  codingAgent?: string;
  model?: string;
  roleReminder?: string;
  /** Empty list is omitted on the wire (undefined) so inheritance is kept. */
  modelOptions?: SpecialistModelOption[];
  /** Explicit reasoning-effort level; omitted when inheriting the model default. */
  reasoningEffort?: string;
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
  customSpecialists: Collection<CustomSpecialist, 'id'>;
  fileSpecialists: Collection<FileSpecialist, 'id'>;
  userOverrides: SpecialistOverrides;
  providerModelOverrides: Record<string, Record<string, string>>;
  overridesLoaded: boolean;
  customSpecialistsLoaded: boolean;
  fileSpecialistsLoaded: boolean;
  bundledSpecialistsLoaded: boolean;
  specialistsFolderPath: string | null;
  /**
   * Daemon `specialists.default` setting (PROTOCOL §5.12): specialist applied
   * when none is chosen (e.g. task Run). Empty string means unset.
   */
  defaultSpecialistId: string;
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: SpecialistsState = {
  bundledSpecialists: [],
  customSpecialists: createCollection<CustomSpecialist, 'id'>('id'),
  fileSpecialists: createCollection<FileSpecialist, 'id'>('id'),
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
  defaultSpecialistId: '',
};

// ============================================================================
// Reducer Actions (pure state updates)
// ============================================================================

export const setBundledSpecialists = createAction<
  [specialists: import('$lib/constants/specialists').Specialist[]]
>('specialists/setBundledSpecialists');
export const setFileSpecialists = createAction<[specialists: FileSpecialist[]]>(
  'specialists/setFileSpecialists',
);
export const setOverridesLoaded = createAction<[loaded: boolean]>('specialists/setOverridesLoaded');
export const setCustomSpecialistsLoaded = createAction<[loaded: boolean]>(
  'specialists/setCustomSpecialistsLoaded',
);
export const setFileSpecialistsLoaded = createAction<[loaded: boolean]>(
  'specialists/setFileSpecialistsLoaded',
);
export const setBundledSpecialistsLoaded = createAction<[loaded: boolean]>(
  'specialists/setBundledSpecialistsLoaded',
);
export const setDefaultSpecialistId = createAction<[specialistId: string]>(
  'specialists/setDefaultSpecialistId',
);
export const refetchSpecialistsRequested = createAction<[]>('specialists/refetchRequested');
// Async actions: the specialists saga settles the per-dispatch promise with the
// daemon write outcome so callers (e.g. the proposal lifecycle) can await it.
export const saveFileSpecialist = createAsyncAction<[specialist: FileSpecialistWritePayload], void>(
  'specialists/saveFile',
  'specialists/saveFileSpecialist',
);
export const deleteFileSpecialist = createAsyncAction<[specialist: FileSpecialistReference], void>(
  'specialists/deleteFile',
  'specialists/deleteFileSpecialist',
);

// ============================================================================
// Reducer
// ============================================================================

export const specialistsReducer = createReducer<SpecialistsState>(initialState);
specialistsReducer.with(setBundledSpecialists, (state, { payload: [specialists] }) => ({
  ...state,
  bundledSpecialists: specialists,
}));
specialistsReducer.with(setFileSpecialists, (state, { payload: [specialists] }) => ({
  ...state,
  fileSpecialists: createCollection<FileSpecialist, 'id'>('id', specialists),
}));
specialistsReducer.with(setOverridesLoaded, (state, { payload: [loaded] }) => ({
  ...state,
  overridesLoaded: loaded,
}));
specialistsReducer.with(setCustomSpecialistsLoaded, (state, { payload: [loaded] }) => ({
  ...state,
  customSpecialistsLoaded: loaded,
}));
specialistsReducer.with(setFileSpecialistsLoaded, (state, { payload: [loaded] }) => ({
  ...state,
  fileSpecialistsLoaded: loaded,
}));
specialistsReducer.with(setBundledSpecialistsLoaded, (state, { payload: [loaded] }) => ({
  ...state,
  bundledSpecialistsLoaded: loaded,
}));
specialistsReducer.with(setDefaultSpecialistId, (state, { payload: [specialistId] }) => ({
  ...state,
  defaultSpecialistId: specialistId,
}));
