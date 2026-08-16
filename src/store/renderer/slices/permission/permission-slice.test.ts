import {
  describe,
  it,
  expect,
} from "vitest";
import {
  createCollection,
  getItems,
} from "@augmentcode/themis/utils/collections/collection-utils";
import { permissionReducer, permissionRequestReceived, removePermissionRequest, initialState, type PermissionState, type PermissionRequest } from "./permission-slice";

const makeRequest = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  requestId: "req-1",
  sessionId: "session-1",
  title: "Allow file access",
  options: [
    { id: "allow_once", label: "Allow", destructive: false },
    { id: "reject_once", label: "Deny", destructive: true },
  ],
  timestamp: 1000,
  ...overrides,
});

describe("permissionReducer", () => {
  it("should return initial state", () => {
    const state = permissionReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("permissionRequestReceived", () => {
    it("should add a new permission request", () => {
      const request = makeRequest();
      const state = permissionReducer(initialState, permissionRequestReceived(request));
      expect(getItems(state.requests)).toHaveLength(1);
      expect(getItems(state.requests)[0]).toEqual(request);
    });

    it("should append to existing requests", () => {
      const prev: PermissionState = {
        requests: createCollection<PermissionRequest, "requestId">("requestId", [
          makeRequest({ requestId: "req-1" }),
        ]),
      };
      const state = permissionReducer(
        prev,
        permissionRequestReceived(makeRequest({ requestId: "req-2" })),
      );
      expect(getItems(state.requests)).toHaveLength(2);
    });
  });

  describe("removePermissionRequest", () => {
    it("should remove a request by ID", () => {
      const prev: PermissionState = {
        requests: createCollection<PermissionRequest, "requestId">("requestId", [
          makeRequest({ requestId: "req-1" }),
          makeRequest({ requestId: "req-2" }),
        ]),
      };
      const state = permissionReducer(prev, removePermissionRequest("req-1"));
      expect(getItems(state.requests)).toHaveLength(1);
      expect(getItems(state.requests)[0].requestId).toBe("req-2");
    });

    it("should return same state if request not found", () => {
      const state = permissionReducer(initialState, removePermissionRequest("nonexistent"));
      expect(state).toBe(initialState);
    });
  });
});

