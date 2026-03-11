import { describe, it, expect } from "vitest";
import {
  zoomReducer,
  setZoomFactor,
  type ZoomState,
} from "./zoom-slice";

const initialState: ZoomState = {
  zoomFactor: 1.0,
};

describe("zoomReducer", () => {
  it("should return initial state", () => {
    const state = zoomReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setZoomFactor", () => {
    it("should set zoom factor", () => {
      const state = zoomReducer(initialState, setZoomFactor(1.5));
      expect(state.zoomFactor).toBe(1.5);
    });

    it("should return same state if zoom factor unchanged", () => {
      const state = zoomReducer(initialState, setZoomFactor(1.0));
      expect(state).toBe(initialState);
    });

    it("should reject zero zoom factor", () => {
      const state = zoomReducer(initialState, setZoomFactor(0));
      expect(state).toBe(initialState);
    });

    it("should reject negative zoom factor", () => {
      const state = zoomReducer(initialState, setZoomFactor(-1));
      expect(state).toBe(initialState);
    });

    it("should accept small positive zoom factor", () => {
      const state = zoomReducer(initialState, setZoomFactor(0.5));
      expect(state.zoomFactor).toBe(0.5);
    });

    it("should accept large zoom factor", () => {
      const state = zoomReducer(initialState, setZoomFactor(3.0));
      expect(state.zoomFactor).toBe(3.0);
    });

    it("should reject NaN zoom factor", () => {
      const state = zoomReducer(initialState, setZoomFactor(NaN));
      expect(state).toBe(initialState);
    });

    it("should reject Infinity zoom factor", () => {
      const state = zoomReducer(initialState, setZoomFactor(Infinity));
      expect(state).toBe(initialState);
    });
  });
});

