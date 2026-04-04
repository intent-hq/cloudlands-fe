import { describe, it, expect } from "vitest";
import {
  featureCodesReducer,
  fetchFeaturesSuccess,
  initialState,
  toggleFeatureCodeDialog,
  type FeatureCodesState,
} from "./feature-codes-slice";
import {
  selectActiveFeatures,
  selectFeatureCodeDialogOpen,
  selectHasActiveFeatures,
  selectIsFeatureEnabled,
} from "./feature-codes-selectors";

describe("featureCodesReducer", () => {
  it("should return initial state", () => {
    const state = featureCodesReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("fetchFeaturesSuccess", () => {
    it("should set active features and mark as initialized", () => {
      const features = ["feature-a", "feature-b"];
      const state = featureCodesReducer(
        initialState,
        fetchFeaturesSuccess(features)
      );
      expect(state.activeFeatures).toEqual(features);
      expect(state.initialized).toBe(true);
    });

    it("should replace existing features on subsequent fetch", () => {
      const prev: FeatureCodesState = {
        activeFeatures: ["old-feature"],
        dialogOpen: false,
        initialized: true,
      };
      const state = featureCodesReducer(
        prev,
        fetchFeaturesSuccess(["new-feature-1", "new-feature-2"])
      );
      expect(state.activeFeatures).toEqual(["new-feature-1", "new-feature-2"]);
    });

    it("should handle empty features array", () => {
      const prev: FeatureCodesState = {
        activeFeatures: ["feature-a"],
        dialogOpen: false,
        initialized: true,
      };
      const state = featureCodesReducer(prev, fetchFeaturesSuccess([]));
      expect(state.activeFeatures).toEqual([]);
      expect(state.initialized).toBe(true);
    });

    it("should not mutate previous state", () => {
      const state = featureCodesReducer(
        initialState,
        fetchFeaturesSuccess(["feature-a"])
      );
      expect(initialState.activeFeatures).toEqual([]);
      expect(initialState.initialized).toBe(false);
      expect(state.activeFeatures).toHaveLength(1);
    });
  });

  describe("toggleFeatureCodeDialog", () => {
    it("should open the dialog when closed", () => {
      const state = featureCodesReducer(initialState, toggleFeatureCodeDialog());
      expect(state.dialogOpen).toBe(true);
    });

    it("should close the dialog when open", () => {
      const state = featureCodesReducer(
        { ...initialState, dialogOpen: true },
        toggleFeatureCodeDialog()
      );
      expect(state.dialogOpen).toBe(false);
    });
  });

  describe("selectors", () => {
    const state = {
      featureCodes: {
        activeFeatures: ["feature-a", "feature-b"],
        dialogOpen: true,
        initialized: true,
      },
    } as any;

    it("selects active feature data", () => {
      expect(selectActiveFeatures.select(state)).toEqual(["feature-a", "feature-b"]);
      expect(selectHasActiveFeatures.select(state)).toBe(true);
      expect(selectIsFeatureEnabled.select(state, "feature-a")).toBe(true);
      expect(selectIsFeatureEnabled.select(state, "feature-c")).toBe(false);
    });

    it("selects the feature dialog state", () => {
      expect(selectFeatureCodeDialogOpen.select(state)).toBe(true);
    });
  });
});

