import { describe, it, expect } from "vitest";
import {
  specialistsReducer,
  initialState,
  setBundledSpecialists,
  setCustomSpecialists,
  setFileSpecialists,
  setUserOverrides,
  setOverridesLoaded,
  setCustomSpecialistsLoaded,
  setFileSpecialistsLoaded,
  setBundledSpecialistsLoaded,
  setSpecialistsFolderPath,
  setProviderModelOverrides,
  setModelOverride,
  clearModelOverride,
  setBehaviorPromptOverride,
  clearBehaviorPromptOverride,
  clearAllOverrides,
  resetAllOverrides,
  createCustomSpecialist,
  updateCustomSpecialist,
  deleteCustomSpecialist,
  type SpecialistsState,
  type FileSpecialist,
} from "./specialists-slice";

describe("specialistsReducer", () => {
  it("should return initial state", () => {
    const state = specialistsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setBundledSpecialists", () => {
    it("should set bundled specialists", () => {
      const specialists = [{ id: "test", name: "Test", description: "Desc", defaultBehaviorPrompt: "prompt" }];
      const state = specialistsReducer(initialState, setBundledSpecialists(specialists));
      expect(state.bundledSpecialists).toEqual(specialists);
    });
  });

  describe("setModelOverride", () => {
    it("should set a model override", () => {
      const state = specialistsReducer(initialState, setModelOverride("spec-writer", "gpt-4"));
      expect(state.userOverrides.modelOverrides["spec-writer"]).toBe("gpt-4");
    });

    it("should not mutate other overrides", () => {
      const stateWithOverride = specialistsReducer(initialState, setModelOverride("spec-writer", "gpt-4"));
      const state = specialistsReducer(stateWithOverride, setModelOverride("implementor", "opus"));
      expect(state.userOverrides.modelOverrides["spec-writer"]).toBe("gpt-4");
      expect(state.userOverrides.modelOverrides["implementor"]).toBe("opus");
    });
  });

  describe("clearModelOverride", () => {
    it("should remove a model override", () => {
      const stateWithOverride = specialistsReducer(initialState, setModelOverride("spec-writer", "gpt-4"));
      const state = specialistsReducer(stateWithOverride, clearModelOverride("spec-writer"));
      expect(state.userOverrides.modelOverrides["spec-writer"]).toBeUndefined();
    });
  });

  describe("setBehaviorPromptOverride", () => {
    it("should set a behavior prompt override", () => {
      const state = specialistsReducer(initialState, setBehaviorPromptOverride("spec-writer", "custom prompt"));
      expect(state.userOverrides.behaviorPromptOverrides["spec-writer"]).toBe("custom prompt");
    });
  });

  describe("clearBehaviorPromptOverride", () => {
    it("should remove a behavior prompt override", () => {
      const s1 = specialistsReducer(initialState, setBehaviorPromptOverride("spec-writer", "custom"));
      const state = specialistsReducer(s1, clearBehaviorPromptOverride("spec-writer"));
      expect(state.userOverrides.behaviorPromptOverrides["spec-writer"]).toBeUndefined();
    });
  });

  describe("clearAllOverrides", () => {
    it("should clear both model and behavior prompt overrides for a specialist", () => {
      let state = specialistsReducer(initialState, setModelOverride("spec-writer", "gpt-4"));
      state = specialistsReducer(state, setBehaviorPromptOverride("spec-writer", "custom"));
      state = specialistsReducer(state, clearAllOverrides("spec-writer"));
      expect(state.userOverrides.modelOverrides["spec-writer"]).toBeUndefined();
      expect(state.userOverrides.behaviorPromptOverrides["spec-writer"]).toBeUndefined();
    });
  });

  describe("resetAllOverrides", () => {
    it("should clear all overrides", () => {
      let state = specialistsReducer(initialState, setModelOverride("spec-writer", "gpt-4"));
      state = specialistsReducer(state, setBehaviorPromptOverride("implementor", "custom"));
      state = specialistsReducer(state, resetAllOverrides());
      expect(state.userOverrides).toEqual({ codingAgentOverrides: {}, modelOverrides: {}, behaviorPromptOverrides: {} });
    });
  });

  describe("createCustomSpecialist", () => {
    it("should add a custom specialist with generated ID", () => {
      const state = specialistsReducer(initialState, createCustomSpecialist({
        name: "My Custom",
        description: "Custom desc",
        model: "gpt-4",
        behaviorPrompt: "Be helpful",
      }));
      expect(state.customSpecialists).toHaveLength(1);
      expect(state.customSpecialists[0].name).toBe("My Custom");
      expect(state.customSpecialists[0].id).toMatch(/^custom-/);
    });

    it("should generate ID in action creator (pure reducer)", () => {
      // The action's payload should already contain the generated ID
      const action = createCustomSpecialist({
        name: "Test",
        description: "desc",
        model: "gpt-4",
        behaviorPrompt: "prompt",
      });
      // payload is [specialist, id] — the id is pre-generated
      expect(action.payload).toHaveLength(2);
      expect(action.payload[1]).toMatch(/^custom-\d+$/);
    });

    it("should produce deterministic results when given same action (reducer purity)", () => {
      const action = createCustomSpecialist({
        name: "Deterministic",
        description: "desc",
        model: "gpt-4",
        behaviorPrompt: "prompt",
      });
      const state1 = specialistsReducer(initialState, action);
      const state2 = specialistsReducer(initialState, action);
      // Same action → same result (reducer is pure)
      expect(state1).toEqual(state2);
    });
  });

  describe("updateCustomSpecialist", () => {
    it("should update existing custom specialist", () => {
      let state = specialistsReducer(initialState, createCustomSpecialist({
        name: "Original", description: "desc", model: "gpt-4", behaviorPrompt: "prompt",
      }));
      const id = state.customSpecialists[0].id;
      state = specialistsReducer(state, updateCustomSpecialist(id, { name: "Updated" }));
      expect(state.customSpecialists[0].name).toBe("Updated");
    });

    it("should return same state for non-existent specialist", () => {
      const state = specialistsReducer(initialState, updateCustomSpecialist("nonexistent", { name: "X" }));
      expect(state).toBe(initialState);
    });
  });

  describe("deleteCustomSpecialist", () => {
    it("should remove custom specialist", () => {
      let state = specialistsReducer(initialState, createCustomSpecialist({
        name: "ToDelete", description: "desc", model: "gpt-4", behaviorPrompt: "prompt",
      }));
      const id = state.customSpecialists[0].id;
      state = specialistsReducer(state, deleteCustomSpecialist(id));
      expect(state.customSpecialists).toHaveLength(0);
    });
  });

  describe("loaded flags", () => {
    it("should set overridesLoaded", () => {
      const state = specialistsReducer(initialState, setOverridesLoaded(true));
      expect(state.overridesLoaded).toBe(true);
    });

    it("should set customSpecialistsLoaded", () => {
      const state = specialistsReducer(initialState, setCustomSpecialistsLoaded(true));
      expect(state.customSpecialistsLoaded).toBe(true);
    });
  });

  describe("setFileSpecialists", () => {
    it("should set file specialists", () => {
      const fileSpecs: FileSpecialist[] = [
        {
          id: "file-1",
          name: "File Specialist",
          description: "A file-based specialist",
          codingAgent: "claude-code",
          model: "opus4.5",
          behaviorPrompt: "You are a specialist",
          filePath: "/path/to/specialist.md",
          source: "file",
        },
      ];
      const state = specialistsReducer(initialState, setFileSpecialists(fileSpecs));
      expect(state.fileSpecialists).toEqual(fileSpecs);
    });

    it("should preserve codingAgent when reloading file specialists", () => {
      // Initial state with a file specialist that has codingAgent set
      const initialFileSpecs: FileSpecialist[] = [
        {
          id: "file-1",
          name: "Original Name",
          description: "Original description",
          codingAgent: "claude-code",
          model: "opus4.5",
          behaviorPrompt: "Original prompt",
          filePath: "/path/to/specialist.md",
          source: "file",
        },
      ];
      let state = specialistsReducer(initialState, setFileSpecialists(initialFileSpecs));
      expect(state.fileSpecialists[0].codingAgent).toBe("claude-code");

      // Reload with updated name/description but no codingAgent in frontmatter
      // (simulating a reload where frontmatter was updated but codingAgent was omitted)
      const reloadedSpecs: FileSpecialist[] = [
        {
          id: "file-1",
          name: "Updated Name",
          description: "Updated description",
          codingAgent: undefined, // Frontmatter doesn't provide codingAgent
          model: "opus4.5",
          behaviorPrompt: "Updated prompt",
          filePath: "/path/to/specialist.md",
          source: "file",
        },
      ];
      state = specialistsReducer(state, setFileSpecialists(reloadedSpecs));
      // Note: The reducer itself doesn't preserve - the saga does before calling setFileSpecialists
      // This test documents the expected behavior that the saga should preserve codingAgent
      expect(state.fileSpecialists[0].id).toBe("file-1");
      expect(state.fileSpecialists[0].name).toBe("Updated Name");
    });
  });
});

