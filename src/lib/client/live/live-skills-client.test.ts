/**
 * Unit tests for LiveSkillsClient.
 *
 * Asserts that the client invokes `skill.list` RPC (PROTOCOL §5.34) with the
 * exact wire payload and handles the PROTOCOL-shaped bare-array response,
 * mapping WireSkill → SkillInfo. Also tests the `skills:changed` (§6.5)
 * subscription and refetch flow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSkillsClient } from "./live-skills-client";
import * as backendTransport from "./backend-transport";

describe("LiveSkillsClient", () => {
  let client: LiveSkillsClient;

  beforeEach(() => {
    client = new LiveSkillsClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("list", () => {
    it("invokes skill.list RPC with workspaceId (PROTOCOL §5.34)", async () => {
      const backendRequestSpy = vi.spyOn(backendTransport, "backendRequest").mockResolvedValue([]);

      await client.list("ws-123");

      expect(backendRequestSpy).toHaveBeenCalledWith("skill.list", { workspaceId: "ws-123" });
    });

    it("maps wire shape to SkillInfo (strips allowedTools/compatibility)", async () => {
      // PROTOCOL §5.34: bare array of skill objects (no envelope).
      vi.spyOn(backendTransport, "backendRequest").mockResolvedValue([
        {
          name: "example-skill",
          description: "A test skill",
          location: "/workspace/.intent/skills/example/SKILL.md",
          scope: "project",
          allowedTools: "*",
          compatibility: "typescript",
        },
        {
          name: "python-expert",
          description: "Python specialist",
          location: "/Users/user/.intent/skills/python-expert/SKILL.md",
          scope: "user",
        },
      ]);

      const result = await client.list("ws-456");

      expect(result).toEqual([
        {
          name: "example-skill",
          description: "A test skill",
          location: "/workspace/.intent/skills/example/SKILL.md",
          scope: "project",
        },
        {
          name: "python-expert",
          description: "Python specialist",
          location: "/Users/user/.intent/skills/python-expert/SKILL.md",
          scope: "user",
        },
      ]);
    });

    it("returns empty array on transport error", async () => {
      vi.spyOn(backendTransport, "backendRequest").mockRejectedValue(new Error("Transport failure"));

      const result = await client.list("ws-789");

      expect(result).toEqual([]);
    });

    it("returns empty array when daemon returns non-array", async () => {
      vi.spyOn(backendTransport, "backendRequest").mockResolvedValue({ skills: [] } as any);

      const result = await client.list("ws-xyz");

      expect(result).toEqual([]);
    });
  });

  describe("subscribe", () => {
    it("emits empty array immediately and registers skills:changed subscription", async () => {
      const backendSubscribeSpy = vi.spyOn(backendTransport, "backendSubscribe").mockResolvedValue({
        subscriptionId: "sub-123",
      });
      const handler = vi.fn();

      const unsubscribe = client.subscribe(handler);

      // Initial emit (empty array).
      expect(handler).toHaveBeenCalledWith([]);
      expect(handler).toHaveBeenCalledTimes(1);

      // Daemon subscription registered.
      await vi.waitFor(() => {
        expect(backendSubscribeSpy).toHaveBeenCalledWith({ eventTypes: ["skills:changed"] });
      });

      unsubscribe();
    });

    it("refetches and emits fresh skill list on skills:changed event", async () => {
      let notificationCallback: ((n: { method: string; params?: unknown }) => void) | undefined;
      vi.spyOn(backendTransport, "onBackendNotification").mockImplementation((cb) => {
        notificationCallback = cb;
        return vi.fn();
      });
      vi.spyOn(backendTransport, "backendSubscribe").mockResolvedValue({
        subscriptionId: "sub-456",
      });

      // Mock the refetch response: skill.list returns a fresh skill.
      const refreshedSkills = [
        { name: "new-skill", description: "Updated skill", location: "/path/new.md", scope: "user" as const },
      ];
      const backendRequestSpy = vi.spyOn(backendTransport, "backendRequest").mockResolvedValue(refreshedSkills);

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);

      // Initial emit: empty array.
      expect(handler).toHaveBeenCalledWith([]);
      handler.mockClear();

      // Simulate daemon sending skills:changed event (PROTOCOL §6.5).
      notificationCallback?.({ method: "skills:changed", params: { workspaceId: "ws-test" } });

      // Wait for the async refetch + handler call.
      await vi.waitFor(() => {
        expect(backendRequestSpy).toHaveBeenCalledWith("skill.list", { workspaceId: "ws-test" });
        expect(handler).toHaveBeenCalledWith(refreshedSkills);
      });

      unsubscribe();
    });

    it("unsubscribes from daemon subscription on dispose", async () => {
      const backendUnsubscribeSpy = vi.spyOn(backendTransport, "backendUnsubscribe").mockResolvedValue(undefined);
      vi.spyOn(backendTransport, "backendSubscribe").mockResolvedValue({
        subscriptionId: "sub-789",
      });

      const unsubscribe = client.subscribe(vi.fn());

      await vi.waitFor(() => {
        expect(backendUnsubscribeSpy).not.toHaveBeenCalled();
      });

      unsubscribe();

      await vi.waitFor(() => {
        expect(backendUnsubscribeSpy).toHaveBeenCalledWith("sub-789");
      });
    });

    it("handles subscription registration failure gracefully", async () => {
      vi.spyOn(backendTransport, "backendSubscribe").mockRejectedValue(new Error("Subscription failed"));
      const handler = vi.fn();

      const unsubscribe = client.subscribe(handler);

      // Still emits initial empty array.
      expect(handler).toHaveBeenCalledWith([]);

      unsubscribe();
    });

    it("keeps the last known-good view when the event-driven refetch fails (#610)", async () => {
      let notificationCallback: ((n: { method: string; params?: unknown }) => void) | undefined;
      vi.spyOn(backendTransport, "onBackendNotification").mockImplementation((cb) => {
        notificationCallback = cb;
        return vi.fn();
      });
      vi.spyOn(backendTransport, "backendSubscribe").mockResolvedValue({ subscriptionId: "sub-1" });
      const backendRequestSpy = vi
        .spyOn(backendTransport, "backendRequest")
        .mockRejectedValue(new Error("Transport failure"));

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);
      expect(handler).toHaveBeenCalledWith([]);
      handler.mockClear();

      // Transient transport failure on the refetch: NO emit — the handler
      // keeps its prior view instead of receiving a wiping [].
      notificationCallback?.({ method: "skills:changed", params: { workspaceId: "ws-test" } });
      await vi.waitFor(() => expect(backendRequestSpy).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(handler).not.toHaveBeenCalled();
      unsubscribe();
    });

    describe("reconnect (RESUB-1, #609)", () => {
      it("re-issues the subscribe and refetches the last-emitted workspace once on reconnect", async () => {
        let notificationCallback: ((n: { method: string; params?: unknown }) => void) | undefined;
        vi.spyOn(backendTransport, "onBackendNotification").mockImplementation((cb) => {
          notificationCallback = cb;
          return vi.fn();
        });
        let reconnect: (() => void) | undefined;
        vi.spyOn(backendTransport, "onBackendReconnected").mockImplementation((cb) => {
          reconnect = cb;
          return vi.fn();
        });
        const backendSubscribeSpy = vi
          .spyOn(backendTransport, "backendSubscribe")
          .mockResolvedValueOnce({ subscriptionId: "sub-1" })
          .mockResolvedValueOnce({ subscriptionId: "sub-2" });
        const backendUnsubscribeSpy = vi
          .spyOn(backendTransport, "backendUnsubscribe")
          .mockResolvedValue(undefined);

        const skills = [
          { name: "a-skill", description: "d", location: "/w/.intent/skills/a/SKILL.md", scope: "project" as const },
        ];
        const backendRequestSpy = vi
          .spyOn(backendTransport, "backendRequest")
          .mockResolvedValue(skills);

        const handler = vi.fn();
        const unsubscribe = client.subscribe(handler);
        await vi.waitFor(() => expect(backendSubscribeSpy).toHaveBeenCalledTimes(1));

        // Establish the last-emitted workspace via a skills:changed event.
        notificationCallback?.({ method: "skills:changed", params: { workspaceId: "ws-test" } });
        await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(skills));
        handler.mockClear();
        backendRequestSpy.mockClear();

        reconnect?.();

        // Re-subscribe with the same wire shape + exactly one snapshot refetch.
        expect(backendSubscribeSpy).toHaveBeenCalledTimes(2);
        expect(backendSubscribeSpy).toHaveBeenLastCalledWith({ eventTypes: ["skills:changed"] });
        await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(skills));
        expect(backendRequestSpy).toHaveBeenCalledTimes(1);
        expect(backendRequestSpy).toHaveBeenCalledWith("skill.list", { workspaceId: "ws-test" });

        // The refreshed id is released on dispose.
        unsubscribe();
        await vi.waitFor(() => expect(backendUnsubscribeSpy).toHaveBeenCalledWith("sub-2"));
      });

      it("re-subscribes without a refetch when no workspace has been emitted yet", async () => {
        let reconnect: (() => void) | undefined;
        vi.spyOn(backendTransport, "onBackendReconnected").mockImplementation((cb) => {
          reconnect = cb;
          return vi.fn();
        });
        const backendSubscribeSpy = vi
          .spyOn(backendTransport, "backendSubscribe")
          .mockResolvedValue({ subscriptionId: "sub-1" });
        const backendRequestSpy = vi.spyOn(backendTransport, "backendRequest").mockResolvedValue([]);

        const unsubscribe = client.subscribe(vi.fn());
        await vi.waitFor(() => expect(backendSubscribeSpy).toHaveBeenCalledTimes(1));

        reconnect?.();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(backendSubscribeSpy).toHaveBeenCalledTimes(2);
        expect(backendRequestSpy).not.toHaveBeenCalled();
        unsubscribe();
      });

      it("keeps the last known-good view when the reconnect refetch fails", async () => {
        let notificationCallback: ((n: { method: string; params?: unknown }) => void) | undefined;
        vi.spyOn(backendTransport, "onBackendNotification").mockImplementation((cb) => {
          notificationCallback = cb;
          return vi.fn();
        });
        let reconnect: (() => void) | undefined;
        vi.spyOn(backendTransport, "onBackendReconnected").mockImplementation((cb) => {
          reconnect = cb;
          return vi.fn();
        });
        vi.spyOn(backendTransport, "backendSubscribe").mockResolvedValue({ subscriptionId: "sub-1" });
        const skills = [
          { name: "a-skill", description: "d", location: "/w/.intent/skills/a/SKILL.md", scope: "project" as const },
        ];
        const backendRequestSpy = vi
          .spyOn(backendTransport, "backendRequest")
          .mockResolvedValueOnce(skills);

        const handler = vi.fn();
        const unsubscribe = client.subscribe(handler);
        notificationCallback?.({ method: "skills:changed", params: { workspaceId: "ws-test" } });
        await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(skills));
        handler.mockClear();

        backendRequestSpy.mockRejectedValueOnce(new Error("Transport failure"));
        reconnect?.();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(handler).not.toHaveBeenCalled();
        unsubscribe();
      });

      it("does nothing when a reconnect races a dispose", async () => {
        let notificationCallback: ((n: { method: string; params?: unknown }) => void) | undefined;
        vi.spyOn(backendTransport, "onBackendNotification").mockImplementation((cb) => {
          notificationCallback = cb;
          return vi.fn();
        });
        let reconnect: (() => void) | undefined;
        vi.spyOn(backendTransport, "onBackendReconnected").mockImplementation((cb) => {
          reconnect = cb;
          return vi.fn();
        });
        const backendSubscribeSpy = vi
          .spyOn(backendTransport, "backendSubscribe")
          .mockResolvedValue({ subscriptionId: "sub-1" });
        const backendRequestSpy = vi.spyOn(backendTransport, "backendRequest").mockResolvedValue([]);

        const handler = vi.fn();
        const unsubscribe = client.subscribe(handler);
        await vi.waitFor(() => expect(backendSubscribeSpy).toHaveBeenCalledTimes(1));
        notificationCallback?.({ method: "skills:changed", params: { workspaceId: "ws-test" } });
        await vi.waitFor(() => expect(backendRequestSpy).toHaveBeenCalledTimes(1));
        handler.mockClear();
        backendRequestSpy.mockClear();

        unsubscribe();
        reconnect?.();
        await new Promise((resolve) => setTimeout(resolve, 0));

        // No re-subscribe, no refetch, no emit after dispose.
        expect(backendSubscribeSpy).toHaveBeenCalledTimes(1);
        expect(backendRequestSpy).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
      });
    });
  });
});
