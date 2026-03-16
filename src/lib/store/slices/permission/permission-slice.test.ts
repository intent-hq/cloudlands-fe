import { describe, it, expect } from "vitest";
import {
  permissionReducer,
  permissionRequestReceived,
  setPendingRequests,
  removePermissionRequest,
  initialState,
  type PermissionState,
  type PermissionRequest,
} from "./permission-slice";

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
      expect(state.requests).toHaveLength(1);
      expect(state.requests[0]).toEqual(request);
    });

    it("should append to existing requests", () => {
      const prev: PermissionState = {
        requests: [makeRequest({ requestId: "req-1" })],
      };
      const state = permissionReducer(
        prev,
        permissionRequestReceived(makeRequest({ requestId: "req-2" })),
      );
      expect(state.requests).toHaveLength(2);
    });
  });

  describe("setPendingRequests", () => {
    it("should add pending requests avoiding duplicates", () => {
      const existing = makeRequest({ requestId: "req-1" });
      const prev: PermissionState = { requests: [existing] };
      const incoming = [
        makeRequest({ requestId: "req-1" }), // duplicate
        makeRequest({ requestId: "req-2" }), // new
      ];
      const state = permissionReducer(prev, setPendingRequests(incoming));
      expect(state.requests).toHaveLength(2);
      expect(state.requests.map((r) => r.requestId)).toEqual(["req-1", "req-2"]);
    });

    it("should return same state if no new requests", () => {
      const existing = makeRequest({ requestId: "req-1" });
      const prev: PermissionState = { requests: [existing] };
      const state = permissionReducer(prev, setPendingRequests([existing]));
      expect(state).toBe(prev);
    });

    it("should add all requests when state is empty", () => {
      const requests = [
        makeRequest({ requestId: "req-1" }),
        makeRequest({ requestId: "req-2" }),
      ];
      const state = permissionReducer(initialState, setPendingRequests(requests));
      expect(state.requests).toHaveLength(2);
    });
  });

  describe("removePermissionRequest", () => {
    it("should remove a request by ID", () => {
      const prev: PermissionState = {
        requests: [
          makeRequest({ requestId: "req-1" }),
          makeRequest({ requestId: "req-2" }),
        ],
      };
      const state = permissionReducer(prev, removePermissionRequest("req-1"));
      expect(state.requests).toHaveLength(1);
      expect(state.requests[0].requestId).toBe("req-2");
    });

    it("should return state with empty array if request not found", () => {
      const state = permissionReducer(initialState, removePermissionRequest("nonexistent"));
      expect(state.requests).toHaveLength(0);
    });
  });
});

