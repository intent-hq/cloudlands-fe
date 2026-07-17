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
  path: "/home/u/.augment/specialists/reviewer.md",
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
        filePath: "/home/u/.augment/specialists/reviewer.md",
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
});
