import type { GitHubAuthRequiredEvent } from "$features/github-auth/types";
import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";

export type GitCredentialsModalError = {
  workspaceId?: string;
  message: string;
  operation: string;
  command?: string;
  cwd?: string;
  rawError?: string;
};

export type GitHubAuthModalState = {
  open: boolean;
  pendingAuth: GitHubAuthRequiredEvent | null;
  modalKey: number;
};

export type GitCredentialsModalState = {
  open: boolean;
  error: GitCredentialsModalError | null;
  shownForWorkspaceIds: Record<string, boolean>;
};

export type GlobalModalsState = {
  githubAuth: GitHubAuthModalState;
  gitCredentials: GitCredentialsModalState;
};

export const initialState: GlobalModalsState = {
  githubAuth: {
    open: false,
    pendingAuth: null,
    modalKey: 0,
  },
  gitCredentials: {
    open: false,
    error: null,
    shownForWorkspaceIds: {},
  },
};

export const openGitHubAuthModal = createAction<[pendingAuth: GitHubAuthRequiredEvent | null]>(
  "globalModals/openGitHubAuthModal"
);

export const closeGitHubAuthModal = createAction("globalModals/closeGitHubAuthModal");

export const openGitCredentialsModal = createAction<[error: GitCredentialsModalError]>(
  "globalModals/openGitCredentialsModal"
);

export const closeGitCredentialsModal = createAction(
  "globalModals/closeGitCredentialsModal"
);

export const globalModalsReducer = createReducer<GlobalModalsState>(initialState)
  .with(openGitHubAuthModal, (state, { payload: [pendingAuth] }) => ({
    ...state,
    githubAuth: {
      open: true,
      pendingAuth,
      modalKey: state.githubAuth.modalKey + 1,
    },
  }))
  .with(closeGitHubAuthModal, (state) => ({
    ...state,
    githubAuth: {
      ...state.githubAuth,
      open: false,
      pendingAuth: null,
    },
  }))
  .with(openGitCredentialsModal, (state, { payload: [error] }) => ({
    ...state,
    gitCredentials: {
      ...state.gitCredentials,
      open: true,
      error,
      shownForWorkspaceIds: error.workspaceId
        ? {
            ...state.gitCredentials.shownForWorkspaceIds,
            [error.workspaceId]: true,
          }
        : state.gitCredentials.shownForWorkspaceIds,
    },
  }))
  .with(closeGitCredentialsModal, (state) => ({
    ...state,
    gitCredentials: {
      ...state.gitCredentials,
      open: false,
      error: null,
    },
  }));