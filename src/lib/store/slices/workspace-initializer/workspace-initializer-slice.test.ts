import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH,
  hydrateWorkspaceInitializer,
  initialState,
  removeWorkspaceInitializerRemoteSetup,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerBranchForRepo,
  setWorkspaceInitializerDefaultParentPath,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerLastSubmittedAgent,
  setWorkspaceInitializerOnboardingFormState,
  setWorkspaceInitializerRecentRepos,
  setWorkspaceInitializerRemoteSetups,
  upsertWorkspaceInitializerRemoteSetup,
  workspaceInitializerReducer,
} from "./workspace-initializer-slice";

describe("workspaceInitializerReducer", () => {
  it("returns initial state", () => {
    expect(workspaceInitializerReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("hydrates persisted initializer state", () => {
    const state = workspaceInitializerReducer(initialState, hydrateWorkspaceInitializer({
      compactFormState: { repoPath: "/repo", selectedModel: "auggie:default" },
      onboardingFormState: { projectSelection: null, step: "project" },
      lastSelectedRepo: { path: "/repo", type: "local" },
      branchByRepo: { "/repo": "dev" },
      defaultParentPath: "~/Code",
      recentRepos: [{ path: "/repo", type: "local", name: "repo" }],
      remoteSetups: [{ id: "remote-1", name: "Remote", host: "host", port: 22, username: "me", workspacePath: "/repo" }],
      lastSubmittedAgent: { selectedSpecialist: null, selectedModel: "auggie:default" },
    }));

    expect(state.hydrated).toBe(true);
    expect(state.compactFormState?.repoPath).toBe("/repo");
    expect(state.onboardingFormState?.step).toBe("project");
    expect(state.lastSelectedRepo?.path).toBe("/repo");
    expect(state.branchByRepo["/repo"]).toBe("dev");
    expect(state.defaultParentPath).toBe("~/Code");
    expect(state.recentRepos.ids).toEqual(["/repo"]);
    expect(state.remoteSetups.ids).toEqual(["remote-1"]);
    expect(state.lastSubmittedAgent?.selectedModel).toBe("auggie:default");
  });

  it("hydrates last selected repo after mount without overwriting in-progress compact state", () => {
    const preHydrationState = workspaceInitializerReducer(
      initialState,
      setCompactWorkspaceInitializerFormState({ repoPath: "/typed-before-hydration" }),
    );

    const hydratedState = workspaceInitializerReducer(preHydrationState, hydrateWorkspaceInitializer({
      compactFormState: null,
      lastSelectedRepo: { path: "/persisted", type: "local", isValidPath: true },
    }));

    expect(hydratedState.hydrated).toBe(true);
    expect(hydratedState.compactFormState?.repoPath).toBe("/typed-before-hydration");
    expect(hydratedState.lastSelectedRepo?.path).toBe("/persisted");
  });

  it("sets form state, repo selection, branch, default parent, and agent settings", () => {
    let state = workspaceInitializerReducer(initialState, setCompactWorkspaceInitializerFormState({ repoPath: "/repo" }));
    state = workspaceInitializerReducer(state, setWorkspaceInitializerOnboardingFormState({ projectSelection: null, skipWorktree: true }));
    state = workspaceInitializerReducer(state, setWorkspaceInitializerLastSelectedRepo({ path: "/repo", type: "local", isValidPath: true }));
    state = workspaceInitializerReducer(state, setWorkspaceInitializerBranchForRepo("/repo", "feature"));
    state = workspaceInitializerReducer(state, setWorkspaceInitializerDefaultParentPath("~/Projects"));
    state = workspaceInitializerReducer(state, setWorkspaceInitializerLastSubmittedAgent({ selectedSpecialist: "builder", isTeamMode: false }));

    expect(state.compactFormState?.repoPath).toBe("/repo");
    expect(state.onboardingFormState?.skipWorktree).toBe(true);
    expect(state.lastSelectedRepo?.isValidPath).toBe(true);
    expect(state.branchByRepo["/repo"]).toBe("feature");
    expect(state.defaultParentPath).toBe("~/Projects");
    expect(state.lastSubmittedAgent?.isTeamMode).toBe(false);
  });

  it("normalizes recent repos and remote setups", () => {
    const recentRepos = Array.from({ length: 12 }, (_, index) => ({
      path: index === 10 ? "" : `/repo-${index}`,
      type: "local" as const,
      name: `repo-${index}`,
    }));
    let state = workspaceInitializerReducer(initialState, setWorkspaceInitializerRecentRepos(recentRepos));
    expect(state.recentRepos.ids).toHaveLength(9);
    expect(state.recentRepos.ids).not.toContain("");

    state = workspaceInitializerReducer(state, setWorkspaceInitializerRemoteSetups([
      { id: "one", name: "One", host: "h", port: 22, username: "u", workspacePath: "/one" },
    ]));
    state = workspaceInitializerReducer(state, upsertWorkspaceInitializerRemoteSetup({
      id: "two",
      name: "Two",
      host: "h",
      port: 22,
      username: "u",
      workspacePath: "/two",
    }));
    expect(state.remoteSetups.ids).toEqual(["one", "two"]);

    state = workspaceInitializerReducer(state, removeWorkspaceInitializerRemoteSetup("one"));
    expect(state.remoteSetups.ids).toEqual(["two"]);
  });

  it("falls back to the default parent for blank values and ignores empty branch repo keys", () => {
    let state = workspaceInitializerReducer(initialState, setWorkspaceInitializerDefaultParentPath(""));
    expect(state.defaultParentPath).toBe(DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH);

    state = workspaceInitializerReducer(state, setWorkspaceInitializerBranchForRepo("", "main"));
    expect(state.branchByRepo).toEqual({});
  });
});