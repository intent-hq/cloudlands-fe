import { describe, it, expect } from "vitest";
import {
  skillsReducer,
  initialState,
  setSkills,
} from "./skills-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";

describe("skillsReducer", () => {
  it("workspaceUnmounted clears workspace state", () => {
    let state = skillsReducer(initialState, setSkills("ws-1", [{ name: "skill-1", description: "desc" } as any]));
    state = skillsReducer(state, setSkills("ws-2", [{ name: "skill-2", description: "desc" } as any]));

    const nextState = skillsReducer(state, workspaceUnmounted("ws-1"));

    expect(nextState.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(nextState.byWorkspaceId["ws-2"]).toBeDefined();
  });
});

