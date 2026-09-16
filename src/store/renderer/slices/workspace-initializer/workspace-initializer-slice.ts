import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  removeItem,
  upsertItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type {
  CompactWorkspaceInitializerFormState,
  WorkspaceInitializerAgentSettings,
  WorkspaceInitializerHydrationState,
  WorkspaceInitializerRecentRepo,
  WorkspaceInitializerRemoteSetup,
  WorkspaceInitializerPendingGitHubPrefill,
  WorkspaceInitializerRepoSelection,
  WorkspaceInitializerState,
  WorkspaceInitializerOnboardingFormState,
  WorkspaceInitializerPrefill,
  NewWorkspaceDraftRestore,
  WorkspaceInitializerCreateResult,
  WorkspaceInitializerDirectoryStatus,
  WorkspaceInitializerGitAvailability,
  WorkspaceInitializerGitRemote,
  WorkspaceInitializerOperation,
  WorkspaceInitializerPromptEnhancement,
  WorkspaceInitializerPullRequestInfo,
  WorkspaceInitializerResolvedModel,
} from './workspace-initializer-types';
import type { CreateWorkspaceRequest } from '$shared/types';
import type {
  DraftAttachment,
  GitHubBranchListing,
  GitHubCachedBranchListing,
  SpecialistDef,
  WorkspaceSetupScript,
  MutationResult,
} from '$lib/client/app-client';
import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
import type { ProviderTestPromptResult } from '$shared/provider-test-prompt';

export const DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH = '~/Developer';
const MAX_RECENT_REPOS = 9;

export const initialState: WorkspaceInitializerState = {
  hydrated: false,
  compactFormState: null,
  onboardingFormState: null,
  lastSelectedRepo: null,
  branchByRepo: {},
  defaultParentPath: DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH,
  recentRepos: createCollection<WorkspaceInitializerRecentRepo, 'path'>('path'),
  remoteSetups: createCollection<WorkspaceInitializerRemoteSetup, 'id'>('id'),
  lastSubmittedAgent: null,
  pendingGitHubPrefill: null,
  githubBranchListings: {},
  prefillReads: {},
  draftRestores: {},
  setupScriptGenerations: {},
  specialistPreviews: {},
  createRequests: {},
  directoryStatusReads: {},
  pullRequestReads: {},
  gitRemoteReads: {},
  gitAvailabilityReads: {},
  providerAvailabilityReads: {},
  providerTests: {},
  promptEnhancements: {},
  modelResolutions: {},
  repositoryPulls: {},
  reasoningEffortUpdates: {},
};

export const hydrateWorkspaceInitializer = createAction<
  [state: WorkspaceInitializerHydrationState]
>('workspaceInitializer/hydrateWorkspaceInitializer');

export const setCompactWorkspaceInitializerFormState = createAction<
  [formState: CompactWorkspaceInitializerFormState | null]
>('workspaceInitializer/setCompactFormState');

export const setWorkspaceInitializerOnboardingFormState = createAction<
  [formState: WorkspaceInitializerOnboardingFormState | null]
>('workspaceInitializer/setOnboardingFormState');

export const debounceWorkspaceInitializerOnboardingFormState = createAction<
  [formState: WorkspaceInitializerOnboardingFormState]
>('workspaceInitializer/debounceOnboardingFormState');

export const cancelWorkspaceInitializerOnboardingFormStateDebounce = createAction(
  'workspaceInitializer/cancelOnboardingFormStateDebounce',
);

export const restoreNewWorkspaceDraftRequested = createAsyncAction<
  [surface: 'compact' | 'onboarding'],
  NewWorkspaceDraftRestore
>(
  'workspaceInitializer/restoreNewWorkspaceDraft',
  'workspaceInitializer/restoreNewWorkspaceDraftRequested',
);

export const saveNewWorkspaceDraftRequested = createAction<
  [text: string, attachments: DraftAttachment[]]
>('workspaceInitializer/saveNewWorkspaceDraftRequested');

export const flushNewWorkspaceDraftRequested = createAction(
  'workspaceInitializer/flushNewWorkspaceDraftRequested',
);

export const clearNewWorkspaceDraftRequested = createAction(
  'workspaceInitializer/clearNewWorkspaceDraftRequested',
);

export const generateWorkspaceSetupScriptRequested = createAsyncAction<
  [workspaceId: string],
  WorkspaceSetupScript | null
>('workspaceInitializer/generateSetupScript', 'workspaceInitializer/generateSetupScriptRequested');

export const listInitializerSpecialistPreviewsRequested = createAsyncAction<
  [provider: string],
  SpecialistDef[]
>(
  'workspaceInitializer/listSpecialistPreviews',
  'workspaceInitializer/listSpecialistPreviewsRequested',
);

export const listGitHubBranchesCachedRequested = createAsyncAction<
  [owner: string, repo: string],
  GitHubCachedBranchListing
>(
  'workspaceInitializer/listGitHubBranchesCached',
  'workspaceInitializer/listGitHubBranchesCachedRequested',
);

export const listGitHubBranchesRequested = createAsyncAction<
  [owner: string, repo: string, prefix?: string],
  GitHubBranchListing
>('workspaceInitializer/listGitHubBranches', 'workspaceInitializer/listGitHubBranchesRequested');

export const loadWorkspaceInitializerGitHubBranches = createAction<
  [
    owner: string,
    repo: string,
    forceRefresh?: boolean,
    cacheEnabled?: boolean,
    networkDelayMs?: number,
  ]
>('workspaceInitializer/loadGitHubBranches');

export const searchWorkspaceInitializerGitHubBranches = createAction<
  [owner: string, repo: string, prefix: string]
>('workspaceInitializer/searchGitHubBranches');

export const setGitHubBranchListingLoading = createAction<
  [owner: string, repo: string, prefix: string]
>('workspaceInitializer/setGitHubBranchListingLoading');
export const setGitHubBranchListing = createAction<
  [
    owner: string,
    repo: string,
    prefix: string,
    branches: string[],
    defaultBranch: string,
    source?: string,
  ]
>('workspaceInitializer/setGitHubBranchListing');
export const setGitHubBranchListingError = createAction<
  [owner: string, repo: string, prefix: string, error: string]
>('workspaceInitializer/setGitHubBranchListingError');

export const readWorkspaceInitializerPrefillRequested = createAsyncAction<
  [consume: boolean],
  WorkspaceInitializerPrefill | null
>('workspaceInitializer/readPrefill', 'workspaceInitializer/readPrefillRequested');

export const createWorkspaceFromInitializerRequested = createAsyncAction<
  [request: CreateWorkspaceRequest],
  WorkspaceInitializerCreateResult
>('workspaceInitializer/createWorkspace', 'workspaceInitializer/createWorkspaceRequested');

export const setInitialAgentReasoningEffortRequested = createAsyncAction<
  [agentId: string, workspaceId: string, reasoningEffort: string],
  void
>(
  'workspaceInitializer/setInitialAgentReasoningEffort',
  'workspaceInitializer/setInitialAgentReasoningEffortRequested',
);

export const connectGitHubForInitializerRequested = createAsyncAction<[], void>(
  'workspaceInitializer/connectGitHub',
  'workspaceInitializer/connectGitHubRequested',
);

export const readWorkspaceInitializerDirectoryStatusRequested = createAsyncAction<
  [path: string],
  WorkspaceInitializerDirectoryStatus | null
>('workspaceInitializer/readDirectoryStatus', 'workspaceInitializer/readDirectoryStatusRequested');

export const readWorkspaceInitializerPullRequestRequested = createAsyncAction<
  [owner: string, repo: string, number: number],
  WorkspaceInitializerPullRequestInfo | null
>('workspaceInitializer/readPullRequest', 'workspaceInitializer/readPullRequestRequested');

export const readWorkspaceInitializerGitRemoteRequested = createAsyncAction<
  [repoPath: string],
  WorkspaceInitializerGitRemote | null
>('workspaceInitializer/readGitRemote', 'workspaceInitializer/readGitRemoteRequested');

export const readWorkspaceInitializerGitAvailabilityRequested = createAsyncAction<
  [],
  WorkspaceInitializerGitAvailability | null
>('workspaceInitializer/readGitAvailability', 'workspaceInitializer/readGitAvailabilityRequested');

export const readWorkspaceInitializerProviderAvailabilityRequested = createAsyncAction<
  [operationKey: string],
  ProviderAvailabilityResult
>(
  'workspaceInitializer/readProviderAvailability',
  'workspaceInitializer/readProviderAvailabilityRequested',
);

export const runWorkspaceInitializerProviderTestRequested = createAsyncAction<
  [operationKey: string, providerId: string, model?: string],
  ProviderTestPromptResult
>('workspaceInitializer/runProviderTest', 'workspaceInitializer/runProviderTestRequested');

export const enhanceWorkspaceInitializerPromptRequested = createAsyncAction<
  [operationKey: string, prompt: string],
  WorkspaceInitializerPromptEnhancement
>('workspaceInitializer/enhancePrompt', 'workspaceInitializer/enhancePromptRequested');

export const resolveWorkspaceInitializerModelRequested = createAsyncAction<
  [operationKey: string, userSelectedModel?: string, userSelectedProvider?: string],
  WorkspaceInitializerResolvedModel
>('workspaceInitializer/resolveModel', 'workspaceInitializer/resolveModelRequested');

export const pullWorkspaceInitializerRepositoryRequested = createAsyncAction<
  [operationKey: string, repoPath: string, branchName: string],
  MutationResult
>('workspaceInitializer/pullRepository', 'workspaceInitializer/pullRepositoryRequested');

export const addWorkspaceInitializerRecentRepositoryRequested = createAsyncAction<
  [repository: { repository: string; name: string; owner: string; githubUrl: string }],
  void
>('workspaceInitializer/addRecentRepository', 'workspaceInitializer/addRecentRepositoryRequested');

export const openWorkspaceInitializerExternalUrlRequested = createAsyncAction<[url: string], void>(
  'workspaceInitializer/openExternalUrl',
  'workspaceInitializer/openExternalUrlRequested',
);

export const setWorkspaceInitializerLastSelectedRepo = createAction<
  [repo: WorkspaceInitializerRepoSelection | null]
>('workspaceInitializer/setLastSelectedRepo');

export const setWorkspaceInitializerBranchForRepo = createAction<
  [repoPath: string, branch: string]
>('workspaceInitializer/setBranchForRepo');

export const setWorkspaceInitializerDefaultParentPath = createAction<[path: string]>(
  'workspaceInitializer/setDefaultParentPath',
);

export const setWorkspaceInitializerRecentRepos = createAction<
  [repos: WorkspaceInitializerRecentRepo[]]
>('workspaceInitializer/setRecentRepos');

export const setWorkspaceInitializerRemoteSetups = createAction<
  [setups: WorkspaceInitializerRemoteSetup[]]
>('workspaceInitializer/setRemoteSetups');

export const upsertWorkspaceInitializerRemoteSetup = createAction<
  [setup: WorkspaceInitializerRemoteSetup]
>('workspaceInitializer/upsertRemoteSetup');

export const removeWorkspaceInitializerRemoteSetup = createAction<[id: string]>(
  'workspaceInitializer/removeRemoteSetup',
);

export const setWorkspaceInitializerLastSubmittedAgent = createAction<
  [settings: WorkspaceInitializerAgentSettings | null]
>('workspaceInitializer/setLastSubmittedAgent');
export const setWorkspaceInitializerPendingGitHubPrefill = createAction<
  [prefill: WorkspaceInitializerPendingGitHubPrefill]
>('workspaceInitializer/setPendingGitHubPrefill');

export const clearWorkspaceInitializerPendingGitHubPrefill = createAction(
  'workspaceInitializer/clearPendingGitHubPrefill',
);

function recentReposCollection(repos: WorkspaceInitializerRecentRepo[]) {
  return createCollection<WorkspaceInitializerRecentRepo, 'path'>(
    'path',
    repos.filter((repo) => repo.path).slice(0, MAX_RECENT_REPOS),
  );
}

const loadingOperation = <T>(
  current?: WorkspaceInitializerOperation<T>,
): WorkspaceInitializerOperation<T> => ({
  status: 'loading',
  version: (current?.version ?? 0) + 1,
  data: current?.data ?? null,
  error: null,
});

const successfulOperation = <T>(
  current: WorkspaceInitializerOperation<T> | undefined,
  data: T,
): WorkspaceInitializerOperation<T> => ({
  status: 'success',
  version: current?.version ?? 1,
  data,
  error: null,
});

const failedOperation = <T>(
  current: WorkspaceInitializerOperation<T> | undefined,
  error: Error,
): WorkspaceInitializerOperation<T> => ({
  status: 'error',
  version: current?.version ?? 1,
  data: current?.data ?? null,
  error: error.message,
});

const prefillKey = (consume: boolean) => (consume ? 'consume' : 'peek');
const pullRequestKey = (owner: string, repo: string, number: number) =>
  JSON.stringify([owner, repo, number]);
const createRequestKey = (request: CreateWorkspaceRequest) => request.progressId ?? 'default';

export const workspaceInitializerReducer = createReducer<WorkspaceInitializerState>(initialState);

workspaceInitializerReducer.with(readWorkspaceInitializerPrefillRequested, (state, { payload }) => {
  const key = prefillKey(payload[0]);
  return {
    ...state,
    prefillReads: { ...state.prefillReads, [key]: loadingOperation(state.prefillReads[key]) },
  };
});
workspaceInitializerReducer.with(
  readWorkspaceInitializerPrefillRequested.success,
  (state, { payload }) => {
    const key = prefillKey(payload.request[0]);
    return {
      ...state,
      prefillReads: {
        ...state.prefillReads,
        [key]: successfulOperation(state.prefillReads[key], payload.response),
      },
    };
  },
);
workspaceInitializerReducer.with(
  readWorkspaceInitializerPrefillRequested.failure,
  (state, { payload }) => {
    const key = prefillKey(payload.request[0]);
    return {
      ...state,
      prefillReads: {
        ...state.prefillReads,
        [key]: failedOperation(state.prefillReads[key], payload.error),
      },
    };
  },
);

workspaceInitializerReducer.with(restoreNewWorkspaceDraftRequested, (state, { payload }) => {
  const key = payload[0];
  return {
    ...state,
    draftRestores: { ...state.draftRestores, [key]: loadingOperation(state.draftRestores[key]) },
  };
});
workspaceInitializerReducer.with(
  restoreNewWorkspaceDraftRequested.success,
  (state, { payload }) => {
    const key = payload.request[0];
    return {
      ...state,
      draftRestores: {
        ...state.draftRestores,
        [key]: successfulOperation(state.draftRestores[key], payload.response),
      },
    };
  },
);
workspaceInitializerReducer.with(
  restoreNewWorkspaceDraftRequested.failure,
  (state, { payload }) => {
    const key = payload.request[0];
    return {
      ...state,
      draftRestores: {
        ...state.draftRestores,
        [key]: failedOperation(state.draftRestores[key], payload.error),
      },
    };
  },
);

workspaceInitializerReducer.with(generateWorkspaceSetupScriptRequested, (state, { payload }) => {
  const key = payload[0];
  return {
    ...state,
    setupScriptGenerations: {
      ...state.setupScriptGenerations,
      [key]: loadingOperation(state.setupScriptGenerations[key]),
    },
  };
});
workspaceInitializerReducer.with(
  generateWorkspaceSetupScriptRequested.success,
  (state, { payload }) => {
    const key = payload.request[0];
    return {
      ...state,
      setupScriptGenerations: {
        ...state.setupScriptGenerations,
        [key]: successfulOperation(state.setupScriptGenerations[key], payload.response),
      },
    };
  },
);
workspaceInitializerReducer.with(
  generateWorkspaceSetupScriptRequested.failure,
  (state, { payload }) => {
    const key = payload.request[0];
    return {
      ...state,
      setupScriptGenerations: {
        ...state.setupScriptGenerations,
        [key]: failedOperation(state.setupScriptGenerations[key], payload.error),
      },
    };
  },
);

workspaceInitializerReducer.with(
  listInitializerSpecialistPreviewsRequested,
  (state, { payload }) => {
    const key = payload[0];
    return {
      ...state,
      specialistPreviews: {
        ...state.specialistPreviews,
        [key]: loadingOperation(state.specialistPreviews[key]),
      },
    };
  },
);
workspaceInitializerReducer.with(
  listInitializerSpecialistPreviewsRequested.success,
  (state, { payload }) => {
    const key = payload.request[0];
    const previews = Object.fromEntries(
      payload.response.map((definition) => [definition.id, definition.resolvedModel]),
    );
    return {
      ...state,
      specialistPreviews: {
        ...state.specialistPreviews,
        [key]: successfulOperation(state.specialistPreviews[key], previews),
      },
    };
  },
);
workspaceInitializerReducer.with(
  listInitializerSpecialistPreviewsRequested.failure,
  (state, { payload }) => {
    const key = payload.request[0];
    return {
      ...state,
      specialistPreviews: {
        ...state.specialistPreviews,
        [key]: failedOperation(state.specialistPreviews[key], payload.error),
      },
    };
  },
);

workspaceInitializerReducer.with(createWorkspaceFromInitializerRequested, (state, { payload }) => {
  const key = createRequestKey(payload[0]);
  return {
    ...state,
    createRequests: { ...state.createRequests, [key]: loadingOperation(state.createRequests[key]) },
  };
});
workspaceInitializerReducer.with(
  createWorkspaceFromInitializerRequested.success,
  (state, { payload }) => {
    const key = createRequestKey(payload.request[0]);
    return {
      ...state,
      createRequests: {
        ...state.createRequests,
        [key]: successfulOperation(state.createRequests[key], payload.response),
      },
    };
  },
);
workspaceInitializerReducer.with(
  createWorkspaceFromInitializerRequested.failure,
  (state, { payload }) => {
    const key = createRequestKey(payload.request[0]);
    return {
      ...state,
      createRequests: {
        ...state.createRequests,
        [key]: failedOperation(state.createRequests[key], payload.error),
      },
    };
  },
);

workspaceInitializerReducer.with(
  readWorkspaceInitializerDirectoryStatusRequested,
  (state, { payload }) => {
    const key = payload[0];
    return {
      ...state,
      directoryStatusReads: {
        ...state.directoryStatusReads,
        [key]: loadingOperation(state.directoryStatusReads[key]),
      },
    };
  },
);
workspaceInitializerReducer.with(
  readWorkspaceInitializerDirectoryStatusRequested.success,
  (state, { payload }) => {
    const key = payload.request[0];
    return {
      ...state,
      directoryStatusReads: {
        ...state.directoryStatusReads,
        [key]: successfulOperation(state.directoryStatusReads[key], payload.response),
      },
    };
  },
);
workspaceInitializerReducer.with(
  readWorkspaceInitializerDirectoryStatusRequested.failure,
  (state, { payload }) => {
    const key = payload.request[0];
    return {
      ...state,
      directoryStatusReads: {
        ...state.directoryStatusReads,
        [key]: failedOperation(state.directoryStatusReads[key], payload.error),
      },
    };
  },
);

workspaceInitializerReducer.with(
  readWorkspaceInitializerPullRequestRequested,
  (state, { payload }) => {
    const key = pullRequestKey(...payload);
    return {
      ...state,
      pullRequestReads: {
        ...state.pullRequestReads,
        [key]: loadingOperation(state.pullRequestReads[key]),
      },
    };
  },
);
workspaceInitializerReducer.with(
  readWorkspaceInitializerPullRequestRequested.success,
  (state, { payload }) => {
    const key = pullRequestKey(...payload.request);
    return {
      ...state,
      pullRequestReads: {
        ...state.pullRequestReads,
        [key]: successfulOperation(state.pullRequestReads[key], payload.response),
      },
    };
  },
);
workspaceInitializerReducer.with(
  readWorkspaceInitializerPullRequestRequested.failure,
  (state, { payload }) => {
    const key = pullRequestKey(...payload.request);
    return {
      ...state,
      pullRequestReads: {
        ...state.pullRequestReads,
        [key]: failedOperation(state.pullRequestReads[key], payload.error),
      },
    };
  },
);

workspaceInitializerReducer.with(
  readWorkspaceInitializerGitRemoteRequested,
  (state, { payload }) => {
    const key = payload[0];
    return {
      ...state,
      gitRemoteReads: {
        ...state.gitRemoteReads,
        [key]: loadingOperation(state.gitRemoteReads[key]),
      },
    };
  },
);
workspaceInitializerReducer.with(
  readWorkspaceInitializerGitRemoteRequested.success,
  (state, { payload }) => {
    const key = payload.request[0];
    return {
      ...state,
      gitRemoteReads: {
        ...state.gitRemoteReads,
        [key]: successfulOperation(state.gitRemoteReads[key], payload.response),
      },
    };
  },
);
workspaceInitializerReducer.with(
  readWorkspaceInitializerGitRemoteRequested.failure,
  (state, { payload }) => {
    const key = payload.request[0];
    return {
      ...state,
      gitRemoteReads: {
        ...state.gitRemoteReads,
        [key]: failedOperation(state.gitRemoteReads[key], payload.error),
      },
    };
  },
);

workspaceInitializerReducer.with(readWorkspaceInitializerGitAvailabilityRequested, (state) => ({
  ...state,
  gitAvailabilityReads: {
    ...state.gitAvailabilityReads,
    default: loadingOperation(state.gitAvailabilityReads.default),
  },
}));
workspaceInitializerReducer.with(
  readWorkspaceInitializerGitAvailabilityRequested.success,
  (state, { payload }) => ({
    ...state,
    gitAvailabilityReads: {
      ...state.gitAvailabilityReads,
      default: successfulOperation(state.gitAvailabilityReads.default, payload.response),
    },
  }),
);
workspaceInitializerReducer.with(
  readWorkspaceInitializerGitAvailabilityRequested.failure,
  (state, { payload }) => ({
    ...state,
    gitAvailabilityReads: {
      ...state.gitAvailabilityReads,
      default: failedOperation(state.gitAvailabilityReads.default, payload.error),
    },
  }),
);

workspaceInitializerReducer.with(
  readWorkspaceInitializerProviderAvailabilityRequested,
  (state, { payload }) => ({
    ...state,
    providerAvailabilityReads: {
      ...state.providerAvailabilityReads,
      [payload[0]]: loadingOperation(state.providerAvailabilityReads[payload[0]]),
    },
  }),
);
workspaceInitializerReducer.with(
  readWorkspaceInitializerProviderAvailabilityRequested.success,
  (state, { payload }) => ({
    ...state,
    providerAvailabilityReads: {
      ...state.providerAvailabilityReads,
      [payload.request[0]]: successfulOperation(
        state.providerAvailabilityReads[payload.request[0]],
        payload.response,
      ),
    },
  }),
);
workspaceInitializerReducer.with(
  readWorkspaceInitializerProviderAvailabilityRequested.failure,
  (state, { payload }) => ({
    ...state,
    providerAvailabilityReads: {
      ...state.providerAvailabilityReads,
      [payload.request[0]]: failedOperation(
        state.providerAvailabilityReads[payload.request[0]],
        payload.error,
      ),
    },
  }),
);

workspaceInitializerReducer.with(
  runWorkspaceInitializerProviderTestRequested,
  (state, { payload }) => ({
    ...state,
    providerTests: {
      ...state.providerTests,
      [payload[0]]: loadingOperation(state.providerTests[payload[0]]),
    },
  }),
);
workspaceInitializerReducer.with(
  runWorkspaceInitializerProviderTestRequested.success,
  (state, { payload }) => ({
    ...state,
    providerTests: {
      ...state.providerTests,
      [payload.request[0]]: successfulOperation(
        state.providerTests[payload.request[0]],
        payload.response,
      ),
    },
  }),
);
workspaceInitializerReducer.with(
  runWorkspaceInitializerProviderTestRequested.failure,
  (state, { payload }) => ({
    ...state,
    providerTests: {
      ...state.providerTests,
      [payload.request[0]]: failedOperation(state.providerTests[payload.request[0]], payload.error),
    },
  }),
);

workspaceInitializerReducer.with(
  enhanceWorkspaceInitializerPromptRequested,
  (state, { payload }) => ({
    ...state,
    promptEnhancements: {
      ...state.promptEnhancements,
      [payload[0]]: loadingOperation(state.promptEnhancements[payload[0]]),
    },
  }),
);
workspaceInitializerReducer.with(
  enhanceWorkspaceInitializerPromptRequested.success,
  (state, { payload }) => ({
    ...state,
    promptEnhancements: {
      ...state.promptEnhancements,
      [payload.request[0]]: successfulOperation(
        state.promptEnhancements[payload.request[0]],
        payload.response,
      ),
    },
  }),
);
workspaceInitializerReducer.with(
  enhanceWorkspaceInitializerPromptRequested.failure,
  (state, { payload }) => ({
    ...state,
    promptEnhancements: {
      ...state.promptEnhancements,
      [payload.request[0]]: failedOperation(
        state.promptEnhancements[payload.request[0]],
        payload.error,
      ),
    },
  }),
);

workspaceInitializerReducer.with(
  resolveWorkspaceInitializerModelRequested,
  (state, { payload }) => ({
    ...state,
    modelResolutions: {
      ...state.modelResolutions,
      [payload[0]]: loadingOperation(state.modelResolutions[payload[0]]),
    },
  }),
);
workspaceInitializerReducer.with(
  resolveWorkspaceInitializerModelRequested.success,
  (state, { payload }) => ({
    ...state,
    modelResolutions: {
      ...state.modelResolutions,
      [payload.request[0]]: successfulOperation(
        state.modelResolutions[payload.request[0]],
        payload.response,
      ),
    },
  }),
);
workspaceInitializerReducer.with(
  resolveWorkspaceInitializerModelRequested.failure,
  (state, { payload }) => ({
    ...state,
    modelResolutions: {
      ...state.modelResolutions,
      [payload.request[0]]: failedOperation(
        state.modelResolutions[payload.request[0]],
        payload.error,
      ),
    },
  }),
);

workspaceInitializerReducer.with(
  pullWorkspaceInitializerRepositoryRequested,
  (state, { payload }) => ({
    ...state,
    repositoryPulls: {
      ...state.repositoryPulls,
      [payload[0]]: loadingOperation(state.repositoryPulls[payload[0]]),
    },
  }),
);
workspaceInitializerReducer.with(
  pullWorkspaceInitializerRepositoryRequested.success,
  (state, { payload }) => ({
    ...state,
    repositoryPulls: {
      ...state.repositoryPulls,
      [payload.request[0]]: successfulOperation(
        state.repositoryPulls[payload.request[0]],
        payload.response,
      ),
    },
  }),
);
workspaceInitializerReducer.with(
  pullWorkspaceInitializerRepositoryRequested.failure,
  (state, { payload }) => ({
    ...state,
    repositoryPulls: {
      ...state.repositoryPulls,
      [payload.request[0]]: failedOperation(
        state.repositoryPulls[payload.request[0]],
        payload.error,
      ),
    },
  }),
);

workspaceInitializerReducer.with(setInitialAgentReasoningEffortRequested, (state, { payload }) => {
  const key = payload[0];
  return {
    ...state,
    reasoningEffortUpdates: {
      ...state.reasoningEffortUpdates,
      [key]: loadingOperation(state.reasoningEffortUpdates[key]),
    },
  };
});
workspaceInitializerReducer.with(
  setInitialAgentReasoningEffortRequested.success,
  (state, { payload }) => {
    const key = payload.request[0];
    return {
      ...state,
      reasoningEffortUpdates: {
        ...state.reasoningEffortUpdates,
        [key]: successfulOperation(state.reasoningEffortUpdates[key], payload.response),
      },
    };
  },
);
workspaceInitializerReducer.with(
  setInitialAgentReasoningEffortRequested.failure,
  (state, { payload }) => {
    const key = payload.request[0];
    return {
      ...state,
      reasoningEffortUpdates: {
        ...state.reasoningEffortUpdates,
        [key]: failedOperation(state.reasoningEffortUpdates[key], payload.error),
      },
    };
  },
);
workspaceInitializerReducer.with(
  hydrateWorkspaceInitializer,
  (state, { payload: [hydration] }) => ({
    ...state,
    hydrated: true,
    compactFormState: hydration.compactFormState ?? state.compactFormState,
    onboardingFormState: hydration.onboardingFormState ?? state.onboardingFormState,
    lastSelectedRepo: hydration.lastSelectedRepo ?? state.lastSelectedRepo,
    branchByRepo: hydration.branchByRepo ?? state.branchByRepo,
    defaultParentPath: hydration.defaultParentPath || state.defaultParentPath,
    recentRepos: hydration.recentRepos
      ? recentReposCollection(hydration.recentRepos)
      : state.recentRepos,
    remoteSetups: hydration.remoteSetups
      ? createCollection<WorkspaceInitializerRemoteSetup, 'id'>('id', hydration.remoteSetups)
      : state.remoteSetups,
    lastSubmittedAgent: hydration.lastSubmittedAgent ?? state.lastSubmittedAgent,
  }),
);
workspaceInitializerReducer.with(
  setCompactWorkspaceInitializerFormState,
  (state, { payload: [compactFormState] }) => ({
    ...state,
    compactFormState,
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerOnboardingFormState,
  (state, { payload: [onboardingFormState] }) => ({
    ...state,
    onboardingFormState,
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerLastSelectedRepo,
  (state, { payload: [lastSelectedRepo] }) => ({
    ...state,
    lastSelectedRepo,
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerBranchForRepo,
  (state, { payload: [repoPath, branch] }) => {
    if (!repoPath) return state;
    return {
      ...state,
      branchByRepo: {
        ...state.branchByRepo,
        [repoPath]: branch,
      },
    };
  },
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerDefaultParentPath,
  (state, { payload: [defaultParentPath] }) => ({
    ...state,
    defaultParentPath: defaultParentPath || DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH,
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerRecentRepos,
  (state, { payload: [recentRepos] }) => ({
    ...state,
    recentRepos: recentReposCollection(recentRepos),
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerRemoteSetups,
  (state, { payload: [remoteSetups] }) => ({
    ...state,
    remoteSetups: createCollection<WorkspaceInitializerRemoteSetup, 'id'>('id', remoteSetups),
  }),
);
workspaceInitializerReducer.with(
  upsertWorkspaceInitializerRemoteSetup,
  (state, { payload: [setup] }) => ({
    ...state,
    remoteSetups: upsertItem(state.remoteSetups, setup),
  }),
);
workspaceInitializerReducer.with(
  removeWorkspaceInitializerRemoteSetup,
  (state, { payload: [id] }) => ({
    ...state,
    remoteSetups: removeItem(state.remoteSetups, id),
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerLastSubmittedAgent,
  (state, { payload: [lastSubmittedAgent] }) => ({
    ...state,
    lastSubmittedAgent,
  }),
);
workspaceInitializerReducer.with(
  setWorkspaceInitializerPendingGitHubPrefill,
  (state, { payload: [pendingGitHubPrefill] }) => ({
    ...state,
    pendingGitHubPrefill,
  }),
);
workspaceInitializerReducer.with(clearWorkspaceInitializerPendingGitHubPrefill, (state) => ({
  ...state,
  pendingGitHubPrefill: null,
}));
const githubBranchListingKey = (owner: string, repo: string, prefix: string) =>
  JSON.stringify([owner, repo, prefix]);
workspaceInitializerReducer.with(
  loadWorkspaceInitializerGitHubBranches,
  (state, { payload: [owner, repo] }) => ({
    ...state,
    githubBranchListings: {
      ...state.githubBranchListings,
      [githubBranchListingKey(owner, repo, '')]: {
        branches: [],
        defaultBranch: '',
        loading: true,
        error: null,
      },
      [githubBranchListingKey(owner, repo, 'cached')]: {
        branches: [],
        defaultBranch: '',
        loading: true,
        error: null,
      },
    },
  }),
);
workspaceInitializerReducer.with(
  searchWorkspaceInitializerGitHubBranches,
  (state, { payload: [owner, repo, prefix] }) => {
    if (!prefix) return state;
    return {
      ...state,
      githubBranchListings: {
        ...state.githubBranchListings,
        [githubBranchListingKey(owner, repo, prefix)]: {
          branches: [],
          defaultBranch: '',
          loading: true,
          error: null,
        },
      },
    };
  },
);
workspaceInitializerReducer.with(
  setGitHubBranchListingLoading,
  (state, { payload: [owner, repo, prefix] }) => {
    const key = githubBranchListingKey(owner, repo, prefix);
    const current = state.githubBranchListings[key];
    return {
      ...state,
      githubBranchListings: {
        ...state.githubBranchListings,
        [key]: {
          branches: current?.branches ?? [],
          defaultBranch: current?.defaultBranch ?? '',
          ...(current?.source ? { source: current.source } : {}),
          loading: true,
          error: null,
        },
      },
    };
  },
);
workspaceInitializerReducer.with(
  setGitHubBranchListing,
  (state, { payload: [owner, repo, prefix, branches, defaultBranch, source] }) => ({
    ...state,
    githubBranchListings: {
      ...state.githubBranchListings,
      [githubBranchListingKey(owner, repo, prefix)]: {
        branches,
        defaultBranch,
        ...(source ? { source } : {}),
        loading: false,
        error: null,
      },
    },
  }),
);
workspaceInitializerReducer.with(
  setGitHubBranchListingError,
  (state, { payload: [owner, repo, prefix, error] }) => {
    const key = githubBranchListingKey(owner, repo, prefix);
    const current = state.githubBranchListings[key];
    return {
      ...state,
      githubBranchListings: {
        ...state.githubBranchListings,
        [key]: {
          branches: current?.branches ?? [],
          defaultBranch: current?.defaultBranch ?? '',
          ...(current?.source ? { source: current.source } : {}),
          loading: false,
          error,
        },
      },
    };
  },
);
