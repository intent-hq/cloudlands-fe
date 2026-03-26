import type { GitHubAuthRequiredEvent } from "$features/github-auth/types";
import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

export type GitCredentialsModalError = {
  workspaceId?: string;
  message: string;
  operation: string;
  command?: string;
  cwd?: string;
  rawError?: string;
};

export type NewSpaceInitialRepo = {
  repoPath?: string;
  isGithub?: boolean;
  owner?: string;
  name?: string;
  environmentType?: string;
  sshConfig?: unknown;
  previousWorkspaceId?: string;
  previousWorkspaceTitle?: string;
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

export type NewSpaceModalState = {
  open: boolean;
  initialRepo: NewSpaceInitialRepo | undefined;
};

export type GlobalModalsState = {
  githubAuth: GitHubAuthModalState;
  gitCredentials: GitCredentialsModalState;
  newSpace: NewSpaceModalState;
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
  newSpace: {
    open: false,
    initialRepo: undefined,
  },
};

export const openGitHubAuthModal = createAction<[pendingAuth: GitHubAuthRequiredEvent | null]>(
  "globalModals/openGitHubAuthModal"
);

export const closeGitHubAuthModal = createAction("globalModals/closeGitHubAuthModal");

export const setGitHubAuthModalState = createAction<[value: GitHubAuthModalState]>(
  "globalModals/setGitHubAuthModalState"
);

export const openGitCredentialsModal = createAction<[error: GitCredentialsModalError]>(
  "globalModals/openGitCredentialsModal"
);

export const closeGitCredentialsModal = createAction(
  "globalModals/closeGitCredentialsModal"
);

export const setGitCredentialsModalState = createAction<[value: GitCredentialsModalState]>(
  "globalModals/setGitCredentialsModalState"
);

export const openNewSpaceModal = createAction<[initialRepo: NewSpaceInitialRepo | undefined]>(
  "globalModals/openNewSpaceModal"
);

export const closeNewSpaceModal = createAction("globalModals/closeNewSpaceModal");

export const setNewSpaceModalState = createAction<[value: NewSpaceModalState]>(
  "globalModals/setNewSpaceModalState"
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
  .with(setGitHubAuthModalState, (state, { payload: [value] }) => ({
    ...state,
    githubAuth: value,
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
  }))
  .with(setGitCredentialsModalState, (state, { payload: [value] }) => ({
    ...state,
    gitCredentials: value,
  }))
  .with(openNewSpaceModal, (state, { payload: [initialRepo] }) => ({
    ...state,
    newSpace: {
      open: true,
      initialRepo,
    },
  }))
  .with(closeNewSpaceModal, (state) => ({
    ...state,
    newSpace: {
      open: false,
      initialRepo: undefined,
    },
  }))
  .with(setNewSpaceModalState, (state, { payload: [value] }) => ({
    ...state,
    newSpace: value,
  }));