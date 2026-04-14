import { describe, expect, it } from "vitest";
import {
  closeGitCredentialsModal,
  closeGitHubAuthModal,
  globalModalsReducer,
  initialState,
  openGitCredentialsModal,
  openGitHubAuthModal,
} from "./global-modals-slice";
import {
  selectGitCredentialsError,
  selectGitCredentialsModal,
  selectGitHubAuthModal,
  selectGitHubAuthModalKey,
  selectGlobalModals,
  selectHasShownGitCredentialsModalForWorkspace,
  selectIsGitCredentialsModalOpen,
  selectIsGitHubAuthModalOpen,
} from "./global-modals-selectors";

const pendingAuth = { reason: "create-pr" } as any;
const credentialsError = {
  workspaceId: "ws-1",
  message: "Permission denied (publickey)",
  operation: "push",
  command: "git push",
  cwd: "/repo",
  rawError: "fatal",
};
describe("globalModalsReducer", () => {
  it("returns the initial state", () => {
    expect(globalModalsReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("opens and closes the GitHub auth modal while incrementing the modal key", () => {
    const opened = globalModalsReducer(initialState, openGitHubAuthModal(pendingAuth));
    expect(opened.githubAuth).toEqual({ open: true, pendingAuth, modalKey: 1 });

    const closed = globalModalsReducer(opened, closeGitHubAuthModal());
    expect(closed.githubAuth).toEqual({ open: false, pendingAuth: null, modalKey: 1 });
  });

  it("stores Git credentials modal state and remembers shown workspaces once", () => {
    const opened = globalModalsReducer(initialState, openGitCredentialsModal(credentialsError));
    const reopened = globalModalsReducer(opened, openGitCredentialsModal(credentialsError));

    expect(reopened.gitCredentials).toEqual({
      open: true,
      error: credentialsError,
      shownForWorkspaceIds: { "ws-1": true },
    });

    const closed = globalModalsReducer(reopened, closeGitCredentialsModal());
    expect(closed.gitCredentials).toEqual({
      open: false,
      error: null,
      shownForWorkspaceIds: { "ws-1": true },
    });
  });

  it("replaces modal sub-state with the explicit set actions", () => {
    const githubState = { open: true, pendingAuth, modalKey: 3 };
    const gitCredentialsState = {
      open: true,
      error: credentialsError,
      shownForWorkspaceIds: { "ws-1": true, "ws-2": true },
    };
    const next = globalModalsReducer(
      globalModalsReducer(initialState, openGitHubAuthModal(githubState.pendingAuth)),
      openGitCredentialsModal(gitCredentialsState.error),
    );

    expect(next.githubAuth.open).toBe(true);
    expect(next.gitCredentials.open).toBe(true);
  });
});

describe("global-modals selectors", () => {
  const state = {
    globalModals: {
      githubAuth: { open: true, pendingAuth, modalKey: 2 },
      gitCredentials: {
        open: true,
        error: credentialsError,
        shownForWorkspaceIds: { "ws-1": true },
      },
    },
  } as any;

  it("selects each modal group and derived values", () => {
    expect(selectGlobalModals.select(state)).toEqual(state.globalModals);
    expect(selectGitHubAuthModal.select(state)).toEqual(state.globalModals.githubAuth);
    expect(selectGitCredentialsModal.select(state)).toEqual(state.globalModals.gitCredentials);
    expect(selectIsGitHubAuthModalOpen.select(state)).toBe(true);
    expect(selectGitHubAuthModalKey.select(state)).toBe(2);
    expect(selectIsGitCredentialsModalOpen.select(state)).toBe(true);
    expect(selectGitCredentialsError.select(state)).toEqual(credentialsError);
  });

  it("tracks whether credentials have already been shown for a workspace", () => {
    expect(selectHasShownGitCredentialsModalForWorkspace.select(state, "ws-1")).toBe(true);
    expect(selectHasShownGitCredentialsModalForWorkspace.select(state, "ws-2")).toBe(false);
    expect(selectHasShownGitCredentialsModalForWorkspace.select(state, undefined)).toBe(false);
  });
});