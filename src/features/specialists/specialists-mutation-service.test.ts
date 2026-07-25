/**
 * Tests for specialists mutation service — asserts each action produces the
 * exact wire request and that PROTOCOL-shaped responses update the store.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// FAKE seam: `appClient.specialists.*` is stubbed. The mutation middleware
// runs against the REAL configured store so we exercise the reducer →
// middleware → wire-call chain end to end.
const { create, edit, deleteSpec, list } = vi.hoisted(() => ({
  create: vi.fn(() => Promise.resolve({} as any)),
  edit: vi.fn(() => Promise.resolve({} as any)),
  deleteSpec: vi.fn(() => Promise.resolve({ success: true })),
  list: vi.fn(() => Promise.resolve([])),
}));
vi.mock("$lib/client", () => ({
  appClient: { specialists: { create, edit, delete: deleteSpec, list } },
}));
vi.mock("svelte-sonner", () => ({ toast: { error: vi.fn() } }));

import type { SpecialistDef } from "$lib/client/app-client";
import { store as appStore } from "$store/renderer/store";
import {
  saveFileSpecialist,
  deleteFileSpecialist,
  exportBuiltinToFile,
  loadFileSpecialists,
  setFileSpecialists,
  setBundledSpecialists,
  type FileSpecialist,
} from "$store/renderer/slices/specialists/specialists-slice";
import { SPECIALISTS } from "$lib/constants/specialists";
import { dispatchSpecialistList } from "./specialists-mutation-service";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const COORDINATOR_DEF: SpecialistDef = {
  id: "spec-writer",
  name: "Coordinator",
  description: "Plans work",
  modelTier: "smart",
  prompt: "You plan.",
  behaviorPrompt: "You plan.",
  source: "bundled",
};

const USER_DEF: SpecialistDef = {
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews",
  model: "opus4.5",
  prompt: "You review.",
  behaviorPrompt: "You review.",
  source: "user",
  path: "/home/u/.intent/specialists/reviewer.md",
};

describe("SpecialistsMutationMiddleware (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue([COORDINATOR_DEF, USER_DEF]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("saveFileSpecialist", () => {
    it("calls specialist.create when no existing file specialist", async () => {
      create.mockResolvedValue(USER_DEF);
      appStore.dispatch(setFileSpecialists([]));

      appStore.dispatch(
        saveFileSpecialist({
          id: "reviewer",
          name: "Reviewer",
          description: "Reviews",
          model: "opus4.5",
          behaviorPrompt: "You review.",
        }),
      );
      await flush();

      expect(create).toHaveBeenCalledWith(
        "reviewer",
        expect.objectContaining({
          id: "reviewer",
          name: "Reviewer",
          description: "Reviews",
          model: "opus4.5",
          behaviorPrompt: "You review.",
          source: "user",
        }),
        "user",
        undefined,
      );
      expect(edit).not.toHaveBeenCalled();
      expect(list).toHaveBeenCalled();
    });

    it("calls specialist.edit when file specialist already exists", async () => {
      const existingFile: FileSpecialist = {
        id: "reviewer",
        name: "Reviewer",
        description: "Reviews",
        model: "opus4.5",
        behaviorPrompt: "You review.",
        filePath: "/home/u/.intent/specialists/reviewer.md",
        source: "user",
      };
      edit.mockResolvedValue(USER_DEF);
      appStore.dispatch(setFileSpecialists([existingFile]));

      appStore.dispatch(
        saveFileSpecialist({
          id: "reviewer",
          name: "Reviewer v2",
          description: "Reviews carefully",
          model: "opus4.5",
          behaviorPrompt: "You review carefully.",
        }),
      );
      await flush();

      expect(edit).toHaveBeenCalledWith(
        "reviewer",
        expect.objectContaining({
          id: "reviewer",
          name: "Reviewer v2",
          description: "Reviews carefully",
          behaviorPrompt: "You review carefully.",
          source: "user",
        }),
        "user",
        undefined,
      );
      expect(create).not.toHaveBeenCalled();
      expect(list).toHaveBeenCalled();
    });

    it("carries hidden from the bundled specialist when creating a user override (chief-of-staff)", async () => {
      // PROTOCOL-shaped bundled def with `hidden: true` (mirrors the intentd
      // SpecialistDef contract change landing in parallel).
      const CHIEF_DEF: SpecialistDef = {
        id: "chief-of-staff",
        name: "Chief of Staff",
        description: "App-level assistant",
        modelTier: "smart",
        prompt: "You assist.",
        behaviorPrompt: "You assist.",
        source: "bundled",
        hidden: true,
      };
      list.mockResolvedValue([CHIEF_DEF]);
      appStore.dispatch(loadFileSpecialists());
      await flush();
      create.mockResolvedValue({ ...CHIEF_DEF, source: "user" });
      appStore.dispatch(setFileSpecialists([]));

      appStore.dispatch(
        saveFileSpecialist({
          id: "chief-of-staff",
          name: "Chief of Staff",
          description: "App-level assistant",
          behaviorPrompt: "You assist better.",
        }),
      );
      await flush();

      expect(create).toHaveBeenCalledWith(
        "chief-of-staff",
        expect.objectContaining({ id: "chief-of-staff", hidden: true, source: "user" }),
        "user",
        undefined,
      );
    });

    it("falls back to the SPECIALISTS constant for hidden before the bundled list loads", async () => {
      // Simulate the pre-load state: the store has no bundled specialists yet
      // (specialist.list has not resolved), so readFileSpecialist must fall
      // back to the static SPECIALISTS constant for built-in flags.
      appStore.dispatch(setBundledSpecialists([]));
      appStore.dispatch(setFileSpecialists([]));
      create.mockResolvedValue({} as any);

      appStore.dispatch(
        saveFileSpecialist({
          id: "chief-of-staff",
          name: "Chief of Staff",
          description: "App-level assistant",
          behaviorPrompt: "You assist.",
        }),
      );
      await flush();

      expect(create).toHaveBeenCalledWith(
        "chief-of-staff",
        expect.objectContaining({ id: "chief-of-staff", hidden: true, source: "user" }),
        "user",
        undefined,
      );
    });

    it("carries hidden from an existing file specialist when editing", async () => {
      const existingHidden: FileSpecialist = {
        id: "chief-of-staff",
        name: "Chief of Staff",
        description: "App-level assistant",
        model: "",
        behaviorPrompt: "You assist.",
        filePath: "/home/u/.intent/specialists/chief-of-staff.md",
        source: "user",
        hidden: true,
      };
      edit.mockResolvedValue({} as any);
      appStore.dispatch(setFileSpecialists([existingHidden]));

      appStore.dispatch(
        saveFileSpecialist({
          id: "chief-of-staff",
          name: "Chief of Staff v2",
          description: "App-level assistant",
          behaviorPrompt: "You assist v2.",
        }),
      );
      await flush();

      expect(edit).toHaveBeenCalledWith(
        "chief-of-staff",
        expect.objectContaining({ hidden: true }),
        "user",
        undefined,
      );
    });

    it("leaves hidden undefined for a non-hidden specialist", async () => {
      create.mockResolvedValue(USER_DEF);
      appStore.dispatch(setFileSpecialists([]));

      appStore.dispatch(
        saveFileSpecialist({
          id: "reviewer",
          name: "Reviewer",
          description: "Reviews",
          behaviorPrompt: "You review.",
        }),
      );
      await flush();

      expect(create).toHaveBeenCalledWith(
        "reviewer",
        expect.objectContaining({ hidden: undefined }),
        "user",
        undefined,
      );
    });

    it("passes scope=project and workspacePath when provided", async () => {
      create.mockResolvedValue(USER_DEF);
      appStore.dispatch(setFileSpecialists([]));

      appStore.dispatch(
        saveFileSpecialist({
          id: "implementor",
          name: "Implementor",
          description: "Implements",
          behaviorPrompt: "You implement.",
          scope: "project",
          workspacePath: "/ws/path",
        }),
      );
      await flush();

      expect(create).toHaveBeenCalledWith(
        "implementor",
        expect.objectContaining({ source: "project" }),
        "project",
        "/ws/path",
      );
    });
  });

  describe("deleteFileSpecialist", () => {
    it("calls specialist.delete and refetches the list", async () => {
      deleteSpec.mockResolvedValue({ success: true });

      appStore.dispatch(deleteFileSpecialist({ id: "reviewer", scope: "user" }));
      await flush();

      expect(deleteSpec).toHaveBeenCalledWith("reviewer", "user", undefined);
      expect(list).toHaveBeenCalled();
    });

    it("passes workspacePath when provided", async () => {
      deleteSpec.mockResolvedValue({ success: true });

      appStore.dispatch(
        deleteFileSpecialist({
          id: "implementor",
          scope: "project",
          workspacePath: "/ws/path",
        }),
      );
      await flush();

      expect(deleteSpec).toHaveBeenCalledWith("implementor", "project", "/ws/path");
    });
  });

  describe("exportBuiltinToFile", () => {
    it("reads bundled specialist and creates a user file", async () => {
      appStore.dispatch(setBundledSpecialists(SPECIALISTS));
      create.mockResolvedValue(COORDINATOR_DEF);

      appStore.dispatch(exportBuiltinToFile("spec-writer"));
      await flush();

      const coordinator = SPECIALISTS.find((s) => s.id === "spec-writer");
      expect(create).toHaveBeenCalledWith(
        "spec-writer",
        expect.objectContaining({
          id: coordinator?.id,
          name: coordinator?.name,
          description: coordinator?.description,
          behaviorPrompt: coordinator?.defaultBehaviorPrompt,
          source: "user",
        }),
        "user",
      );
      expect(list).toHaveBeenCalled();
    });

    it("carries hidden when exporting a hidden built-in (chief-of-staff)", async () => {
      appStore.dispatch(setBundledSpecialists(SPECIALISTS));
      create.mockResolvedValue({} as any);

      appStore.dispatch(exportBuiltinToFile("chief-of-staff"));
      await flush();

      expect(create).toHaveBeenCalledWith(
        "chief-of-staff",
        expect.objectContaining({ id: "chief-of-staff", hidden: true, source: "user" }),
        "user",
      );
    });
  });

  describe("loadFileSpecialists", () => {
    it("refetches specialist.list and dispatches bundled/file split", async () => {
      appStore.dispatch(loadFileSpecialists());

      await vi.waitFor(() => expect(list).toHaveBeenCalled());
      expect(list).toHaveBeenCalledWith();
      await vi.waitFor(() => {
        const state = appStore.state as { specialists?: { bundledSpecialistsLoaded?: boolean } };
        return state.specialists?.bundledSpecialistsLoaded === true;
      });
    });
  });

  describe("store updates", () => {
    it("refetches the list after save and updates state", async () => {
      create.mockResolvedValue(USER_DEF);
      appStore.dispatch(setFileSpecialists([]));

      appStore.dispatch(
        saveFileSpecialist({
          id: "reviewer",
          name: "Reviewer",
          description: "Reviews",
          behaviorPrompt: "You review.",
        }),
      );
      await flush();

      expect(create).toHaveBeenCalled();
      expect(list).toHaveBeenCalled();
    });
  });

  describe("STAB-117 regression: bundled specialists shadowed by user files", () => {
    /**
     * CRITICAL regression test for S2: "Reset on a single specialist resets all specialists."
     *
     * Scenario: All 9 built-ins have user files (mtime Jul 20 08:30). User clicks Reset
     * on one specialist → daemon `specialist.delete` succeeds. The FE refetches
     * `specialist.list`, which returns tier-merged results: the reset ID comes back
     * with source="bundled", but the other 8 still have user files and come back as
     * source="user". Their bundled definitions are ABSENT from the response (higher
     * tier wins per ID).
     *
     * Bug: the old `refetchAndDispatch()` filtered `defs` by source="bundled", got a
     * 1-element array (the reset specialist), and replaced the bundled list with
     * just that entry. The other 8 lost their bundled identity (`selectIsBuiltIn` →
     * false), so Reset buttons/default prompts/models appeared reset/broken across
     * ALL specialists.
     *
     * Fix: `refetchAndDispatch()` reconstructs the bundled set from SPECIALISTS
     * constant union daemon-returned bundled entries, preserving all built-in
     * identities regardless of which IDs have user overrides.
     */
    it("preserves all built-in identities when daemon returns only one bundled entry", async () => {
      // All 9 built-ins have user files initially (daemon returns all as source="user").
      const all9AsUser: SpecialistDef[] = SPECIALISTS.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        model: "fable-5",
        behaviorPrompt: s.defaultBehaviorPrompt,
        source: "user" as const,
        path: `/home/u/.intent/specialists/${s.id}.md`,
      }));
      list.mockResolvedValue(all9AsUser);
      appStore.dispatch(loadFileSpecialists());
      await flush();

      // Verify the bundled list is empty before the reset (all shadowed by user files).
      {
        const state = appStore.state as { specialists?: { bundledSpecialists?: typeof SPECIALISTS } };
        // The refetch should have reconstructed the bundled set from SPECIALISTS. Even
        // though the daemon returned zero entries with source="bundled", all 9 built-ins are present.
        expect(state.specialists?.bundledSpecialists).toHaveLength(9);
        expect(state.specialists?.bundledSpecialists?.map((s) => s.id).sort()).toEqual(
          SPECIALISTS.map((s) => s.id).sort(),
        );
      }

      // User clicks Reset on spec-writer → daemon deletes the user file. The daemon
      // now returns spec-writer with source="bundled" (no longer shadowed), but the
      // other 8 still have user files and come back as source="user".
      const afterReset: SpecialistDef[] = [
        {
          id: "spec-writer",
          name: "Coordinator",
          description: "Plans work",
          modelTier: "smart",
          prompt: "You plan.",
          behaviorPrompt: "You plan.",
          source: "bundled" as const,
        },
        ...all9AsUser.filter((s) => s.id !== "spec-writer"),
      ];
      list.mockResolvedValue(afterReset);

      // Trigger the refetch (simulating the delete path).
      appStore.dispatch(deleteFileSpecialist({ id: "spec-writer", scope: "user" }));
      await flush();

      // ASSERTION: All 9 built-ins must retain their bundled identity (selectIsBuiltIn
      // → true), with correct default prompts/models. The other 8 must NOT lose their
      // bundled state even though the daemon returned them as source="user".
      const state = appStore.state as { specialists?: { bundledSpecialists?: typeof SPECIALISTS } };
      const bundled = state.specialists?.bundledSpecialists ?? [];
      expect(bundled).toHaveLength(9);

      // Check that all built-in IDs are present.
      const bundledIds = new Set(bundled.map((s) => s.id));
      for (const builtin of SPECIALISTS) {
        expect(bundledIds.has(builtin.id), `bundled set missing ${builtin.id}`).toBe(true);
      }

      // Verify that the bundled set has correct default values for each built-in
      // (not corrupted by the user overrides in the daemon response).
      for (const builtin of SPECIALISTS) {
        const bundledEntry = bundled.find((s) => s.id === builtin.id);
        expect(bundledEntry, `bundled entry for ${builtin.id} missing`).toBeDefined();
        // The bundled entry should have the built-in's default prompt/model (from
        // SPECIALISTS constant or the daemon-returned bundled def if fresher).
        // For spec-writer (the reset one), the daemon returned it with source="bundled",
        // so it should overlay the SPECIALISTS entry. For the others, they should
        // fall back to SPECIALISTS.
        if (builtin.id === "spec-writer") {
          // This one was returned by the daemon with source="bundled", so it should
          // match the daemon response (overlaid onto SPECIALISTS).
          expect(bundledEntry?.name).toBe("Coordinator");
        } else {
          // These were returned with source="user", so the bundled set should use
          // the SPECIALISTS constant entry (not the user override).
          expect(bundledEntry?.id).toBe(builtin.id);
          expect(bundledEntry?.source).toBe("bundled");
        }
      }
    });

    it("adds daemon-returned bundled IDs not in SPECIALISTS (future-proof)", async () => {
      // The daemon returns a new bundled specialist not in SPECIALISTS (simulating
      // a future daemon update that adds a new built-in).
      const newBundled: SpecialistDef = {
        id: "future-specialist",
        name: "Future Specialist",
        description: "A new bundled specialist",
        modelTier: "balanced",
        prompt: "You specialize.",
        behaviorPrompt: "You specialize.",
        source: "bundled",
      };
      list.mockResolvedValue([COORDINATOR_DEF, newBundled]);

      appStore.dispatch(loadFileSpecialists());
      await flush();

      const state = appStore.state as { specialists?: { bundledSpecialists?: typeof SPECIALISTS } };
      const bundled = state.specialists?.bundledSpecialists ?? [];

      // The bundled set should include all 9 built-ins plus the new one.
      expect(bundled.length).toBeGreaterThanOrEqual(10);
      const futureEntry = bundled.find((s) => s.id === "future-specialist");
      expect(futureEntry).toBeDefined();
      expect(futureEntry?.name).toBe("Future Specialist");
    });
  });

  describe("dispatchSpecialistList (exported for the specialists:changed live subscription)", () => {
    it("dispatches the bundled/file split directly from a defs array (no refetch)", async () => {
      dispatchSpecialistList([COORDINATOR_DEF, USER_DEF]);

      // No wire call: the live subscription hands the already-refetched defs in.
      expect(list).not.toHaveBeenCalled();

      const state = appStore.state as {
        specialists?: {
          bundledSpecialists?: typeof SPECIALISTS;
          fileSpecialists?: { map: Record<string, FileSpecialist> };
          fileSpecialistsLoaded?: boolean;
        };
      };
      // Bundled set reconstructed from SPECIALISTS overlaid with the daemon entry.
      expect(state.specialists?.bundledSpecialists?.length).toBeGreaterThanOrEqual(
        SPECIALISTS.length,
      );
      expect(state.specialists?.fileSpecialists?.map["reviewer"]).toBeDefined();
      expect(state.specialists?.fileSpecialistsLoaded).toBe(true);
    });
  });
});
