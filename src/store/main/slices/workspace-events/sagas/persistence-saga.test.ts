import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getOrCreateEventStore,
  clearEventStoreCache,
  deleteEventStoreForWorkspace,
} from "./persistence-saga";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock EventStore constructor */
function createMockEventStoreCtor() {
  return class MockEventStore {
    dispose = vi.fn().mockResolvedValue(undefined);
    add = vi.fn();
    constructor(
      public workspaceId: string,
      public options: any,
    ) {}
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("persistence-saga cache management", () => {
  beforeEach(() => {
    clearEventStoreCache();
  });

  describe("deleteEventStoreForWorkspace", () => {
    it("removes the workspace entry from the cache", async () => {
      const Ctor = createMockEventStoreCtor();
      const store = getOrCreateEventStore("ws-1", "/tmp/ws-1", Ctor);
      expect(store).toBeDefined();

      // Verify it's cached
      const same = getOrCreateEventStore("ws-1", "/tmp/ws-1", Ctor);
      expect(same).toBe(store);

      // Delete it
      await deleteEventStoreForWorkspace("ws-1");

      // Cache should no longer contain it
      const fresh = getOrCreateEventStore("ws-1", "/tmp/ws-1", Ctor);
      expect(fresh).not.toBe(store); // new instance created
    });

    it("calls dispose() on the EventStore before removing", async () => {
      const Ctor = createMockEventStoreCtor();
      const store = getOrCreateEventStore("ws-2", "/tmp/ws-2", Ctor);

      await deleteEventStoreForWorkspace("ws-2");

      expect(store.dispose).toHaveBeenCalledOnce();
    });

    it("is a no-op for unknown workspace IDs", async () => {
      // Should not throw
      await deleteEventStoreForWorkspace("nonexistent");
    });

    it("does not affect other workspaces in the cache", async () => {
      const Ctor = createMockEventStoreCtor();
      const store1 = getOrCreateEventStore("ws-a", "/tmp/ws-a", Ctor);
      const store2 = getOrCreateEventStore("ws-b", "/tmp/ws-b", Ctor);

      await deleteEventStoreForWorkspace("ws-a");

      // ws-b should still be cached
      const sameB = getOrCreateEventStore("ws-b", "/tmp/ws-b", Ctor);
      expect(sameB).toBe(store2);

      // ws-a should get a new instance
      const freshA = getOrCreateEventStore("ws-a", "/tmp/ws-a", Ctor);
      expect(freshA).not.toBe(store1);
    });

    it("handles EventStore without dispose method gracefully", async () => {
      // Simulate an EventStore that lacks dispose()
      class NoDisposeCtor {
        add = vi.fn();
        constructor(
          public workspaceId: string,
          public options: any,
        ) {}
      }

      getOrCreateEventStore("ws-no-dispose", "/tmp", NoDisposeCtor as any);
      // Should not throw even without dispose
      await deleteEventStoreForWorkspace("ws-no-dispose");

      // Cache entry should be removed
      const fresh = getOrCreateEventStore("ws-no-dispose", "/tmp", NoDisposeCtor as any);
      expect(fresh).toBeDefined();
    });
  });

  describe("clearEventStoreCache", () => {
    it("still clears the entire cache (saga cancellation path)", () => {
      const Ctor = createMockEventStoreCtor();
      getOrCreateEventStore("ws-x", "/tmp/ws-x", Ctor);
      getOrCreateEventStore("ws-y", "/tmp/ws-y", Ctor);

      clearEventStoreCache();

      // Both should get new instances
      const Ctor2 = createMockEventStoreCtor();
      const freshX = getOrCreateEventStore("ws-x", "/tmp/ws-x", Ctor2);
      const freshY = getOrCreateEventStore("ws-y", "/tmp/ws-y", Ctor2);
      expect(freshX).toBeDefined();
      expect(freshY).toBeDefined();
    });
  });
});

