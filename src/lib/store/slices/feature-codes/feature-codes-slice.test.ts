import { describe, it, expect } from "vitest";
import {
  featureCodesReducer,
  fetchFeaturesSuccess,
  deactivateFeatureSuccess,
  initialState,
  type FeatureCodesState,
} from "./feature-codes-slice";

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

  describe("deactivateFeatureSuccess", () => {
    it("should remove the specified feature", () => {
      const prev: FeatureCodesState = {
        activeFeatures: ["feature-a", "feature-b", "feature-c"],
        initialized: true,
      };
      const state = featureCodesReducer(
        prev,
        deactivateFeatureSuccess("feature-b")
      );
      expect(state.activeFeatures).toEqual(["feature-a", "feature-c"]);
    });

    it("should return same state if feature not found", () => {
      const prev: FeatureCodesState = {
        activeFeatures: ["feature-a"],
        initialized: true,
      };
      const state = featureCodesReducer(
        prev,
        deactivateFeatureSuccess("nonexistent")
      );
      expect(state.activeFeatures).toEqual(["feature-a"]);
    });

    it("should handle empty features array", () => {
      const prev: FeatureCodesState = {
        activeFeatures: [],
        initialized: true,
      };
      const state = featureCodesReducer(
        prev,
        deactivateFeatureSuccess("feature-a")
      );
      expect(state.activeFeatures).toEqual([]);
    });

    it("should not mutate previous state", () => {
      const prev: FeatureCodesState = {
        activeFeatures: ["feature-a", "feature-b"],
        initialized: true,
      };
      const state = featureCodesReducer(
        prev,
        deactivateFeatureSuccess("feature-a")
      );
      expect(prev.activeFeatures).toEqual(["feature-a", "feature-b"]);
      expect(state.activeFeatures).toEqual(["feature-b"]);
    });
  });
});

