import { describe, expect, it } from "vitest";
import { UNASSIGNED_KEY_PIN } from "$features/hardware-console/assignment/key-assignment";
import {
  actionHudHidden,
  actionHudShown,
  encoderHudHidden,
  encoderHudShown,
  hardwareConsoleReducer,
  hydrateHardwareConsoleActionMapping,
  hydrateHardwareConsoleCycleScopes,
  hydrateHardwareConsoleEnabled,
  hydrateHardwareConsoleKeyPins,
  hydrateHardwareConsolePrompts,
  initialState,
  keyPinsReconciled,
  markKeySlotUnassigned,
  pinWorkspaceToKey,
  setActionKeyMapping,
  setCycleScope,
  setHardwareConsoleEnabled,
  setPromptPickerLimit,
  promptUsageRecorded,
  radialPromptPickerClosed,
  radialPromptPickerOpened,
  radialPromptPickerSectorChanged,
  unpinWorkspaceFromKeys,
} from "./hardware-console-slice";

describe("hardwareConsoleReducer", () => {
  it("returns initial state", () => {
    const state = hardwareConsoleReducer(undefined, { type: "@@INIT" });

    expect(state).toEqual(initialState);
    expect(state.keyPins).toEqual([null, null, null, null, null, null]);
    expect(state.hydrated).toBe(false);
  });

  it("hydrates pins (normalized to 6 slots) and marks hydrated", () => {
    const state = hardwareConsoleReducer(initialState, hydrateHardwareConsoleKeyPins(["ws-1"]));

    expect(state.keyPins).toEqual(["ws-1", null, null, null, null, null]);
    expect(state.excludedWorkspaceIds).toEqual([]);
    expect(state.hydrated).toBe(true);
  });

  it("hydrates the auto-fill exclusion list (deduplicated, strings only)", () => {
    const state = hardwareConsoleReducer(
      initialState,
      hydrateHardwareConsoleKeyPins([], ["ws-x", "ws-x", "", UNASSIGNED_KEY_PIN, "ws-y"]),
    );

    expect(state.excludedWorkspaceIds).toEqual(["ws-x", "ws-y"]);
    expect(state.hydrated).toBe(true);
  });

  it("applies a reconciled pin array without touching exclusions", () => {
    const hydrated = hardwareConsoleReducer(
      initialState,
      hydrateHardwareConsoleKeyPins([], ["ws-x"]),
    );
    const state = hardwareConsoleReducer(hydrated, keyPinsReconciled(["ws-1", "ws-2"]));

    expect(state.keyPins).toEqual(["ws-1", "ws-2", null, null, null, null]);
    expect(state.excludedWorkspaceIds).toEqual(["ws-x"]);
  });

  it("returns the same state for a no-op reconcile", () => {
    const pinned = hardwareConsoleReducer(initialState, pinWorkspaceToKey(0, "ws-1"));
    const state = hardwareConsoleReducer(pinned, keyPinsReconciled(["ws-1"]));

    expect(state).toBe(pinned);
  });

  it("pins a workspace to a slot", () => {
    const state = hardwareConsoleReducer(initialState, pinWorkspaceToKey(2, "ws-1"));

    expect(state.keyPins).toEqual([null, null, "ws-1", null, null, null]);
  });

  it("moves a pin when the workspace is pinned to a different slot", () => {
    const pinned = hardwareConsoleReducer(initialState, pinWorkspaceToKey(0, "ws-1"));
    const state = hardwareConsoleReducer(pinned, pinWorkspaceToKey(4, "ws-1"));

    expect(state.keyPins).toEqual([null, null, null, null, "ws-1", null]);
  });

  it("replaces the previous occupant of a slot", () => {
    const pinned = hardwareConsoleReducer(initialState, pinWorkspaceToKey(1, "ws-1"));
    const state = hardwareConsoleReducer(pinned, pinWorkspaceToKey(1, "ws-2"));

    expect(state.keyPins).toEqual([null, "ws-2", null, null, null, null]);
  });

  it("returns the same state when re-pinning to the same slot", () => {
    const pinned = hardwareConsoleReducer(initialState, pinWorkspaceToKey(3, "ws-1"));
    const state = hardwareConsoleReducer(pinned, pinWorkspaceToKey(3, "ws-1"));

    expect(state).toBe(pinned);
  });

  it("ignores out-of-range slots", () => {
    expect(hardwareConsoleReducer(initialState, pinWorkspaceToKey(-1, "ws-1"))).toBe(initialState);
    expect(hardwareConsoleReducer(initialState, pinWorkspaceToKey(6, "ws-1"))).toBe(initialState);
  });

  it("unpins a workspace from its slot and excludes it from auto-fill", () => {
    const pinned = hardwareConsoleReducer(initialState, pinWorkspaceToKey(5, "ws-1"));
    const state = hardwareConsoleReducer(pinned, unpinWorkspaceFromKeys("ws-1"));

    expect(state.keyPins).toEqual([null, null, null, null, null, null]);
    expect(state.excludedWorkspaceIds).toEqual(["ws-1"]);
  });

  it("unpinning an unpinned workspace still records the exclusion", () => {
    const state = hardwareConsoleReducer(initialState, unpinWorkspaceFromKeys("ws-x"));

    expect(state.keyPins).toEqual(initialState.keyPins);
    expect(state.excludedWorkspaceIds).toEqual(["ws-x"]);
  });

  it("returns the same state when unpinning an already-excluded workspace", () => {
    const excluded = hardwareConsoleReducer(initialState, unpinWorkspaceFromKeys("ws-x"));
    const state = hardwareConsoleReducer(excluded, unpinWorkspaceFromKeys("ws-x"));

    expect(state).toBe(excluded);
  });

  it("pinning a workspace clears its auto-fill exclusion", () => {
    const excluded = hardwareConsoleReducer(initialState, unpinWorkspaceFromKeys("ws-1"));
    const state = hardwareConsoleReducer(excluded, pinWorkspaceToKey(2, "ws-1"));

    expect(state.keyPins).toEqual([null, null, "ws-1", null, null, null]);
    expect(state.excludedWorkspaceIds).toEqual([]);
  });

  it("re-pinning to the same slot clears a stale exclusion", () => {
    const pinned = hardwareConsoleReducer(initialState, pinWorkspaceToKey(3, "ws-1"));
    const excluded = { ...pinned, excludedWorkspaceIds: ["ws-1"] };
    const state = hardwareConsoleReducer(excluded, pinWorkspaceToKey(3, "ws-1"));

    expect(state.keyPins).toEqual(pinned.keyPins);
    expect(state.excludedWorkspaceIds).toEqual([]);
  });

  it("marks a slot sticky-unassigned", () => {
    const state = hardwareConsoleReducer(initialState, markKeySlotUnassigned(2));

    expect(state.keyPins).toEqual([null, null, UNASSIGNED_KEY_PIN, null, null, null]);
    expect(state.excludedWorkspaceIds).toEqual([]);
  });

  it("marking a pinned slot unassigned replaces the pin and excludes the evicted workspace", () => {
    const pinned = hardwareConsoleReducer(initialState, pinWorkspaceToKey(1, "ws-1"));
    const state = hardwareConsoleReducer(pinned, markKeySlotUnassigned(1));

    expect(state.keyPins).toEqual([null, UNASSIGNED_KEY_PIN, null, null, null, null]);
    expect(state.excludedWorkspaceIds).toEqual(["ws-1"]);
  });

  it("pinning over a sticky-unassigned slot reclaims it", () => {
    const unassigned = hardwareConsoleReducer(initialState, markKeySlotUnassigned(0));
    const state = hardwareConsoleReducer(unassigned, pinWorkspaceToKey(0, "ws-1"));

    expect(state.keyPins).toEqual(["ws-1", null, null, null, null, null]);
  });

  it("ignores out-of-range and redundant sticky-unassign marks", () => {
    expect(hardwareConsoleReducer(initialState, markKeySlotUnassigned(-1))).toBe(initialState);
    expect(hardwareConsoleReducer(initialState, markKeySlotUnassigned(6))).toBe(initialState);
    const unassigned = hardwareConsoleReducer(initialState, markKeySlotUnassigned(3));
    expect(hardwareConsoleReducer(unassigned, markKeySlotUnassigned(3))).toBe(unassigned);
  });

  it("defaults to enabled, unhydrated", () => {
    expect(initialState.enabled).toBe(true);
    expect(initialState.enabledHydrated).toBe(false);
  });

  it("hydrates the enabled flag and marks enabledHydrated", () => {
    const disabled = hardwareConsoleReducer(initialState, hydrateHardwareConsoleEnabled(false));
    expect(disabled.enabled).toBe(false);
    expect(disabled.enabledHydrated).toBe(true);

    const enabled = hardwareConsoleReducer(initialState, hydrateHardwareConsoleEnabled(true));
    expect(enabled.enabled).toBe(true);
    expect(enabled.enabledHydrated).toBe(true);
  });

  it("toggles the enabled flag and no-ops on redundant sets", () => {
    const disabled = hardwareConsoleReducer(initialState, setHardwareConsoleEnabled(false));
    expect(disabled.enabled).toBe(false);
    expect(hardwareConsoleReducer(disabled, setHardwareConsoleEnabled(false))).toBe(disabled);

    const reenabled = hardwareConsoleReducer(disabled, setHardwareConsoleEnabled(true));
    expect(reenabled.enabled).toBe(true);
  });

  it("sets the prompt picker limit, clamped to [1, 12]", () => {
    expect(hardwareConsoleReducer(initialState, setPromptPickerLimit(5)).promptPickerLimit).toBe(5);
    expect(
      hardwareConsoleReducer(initialState, setPromptPickerLimit(99)).promptPickerLimit,
    ).toBe(12);
    expect(hardwareConsoleReducer(initialState, setPromptPickerLimit(0)).promptPickerLimit).toBe(1);
    expect(hardwareConsoleReducer(initialState, setPromptPickerLimit(8))).toBe(initialState);
  });

  it("hydrates the prompt tracker with a clamped limit and marks promptsHydrated", () => {
    const usage = [{ text: "fix tests", count: 3, lastUsedAt: "2026-01-01T00:00:00.000Z" }];
    const state = hardwareConsoleReducer(initialState, hydrateHardwareConsolePrompts(usage, 99));

    expect(state.promptUsage).toEqual(usage);
    expect(state.promptPickerLimit).toBe(12);
    expect(state.promptsHydrated).toBe(true);
  });

  it("records prompt usage with an ISO timestamp", () => {
    const state = hardwareConsoleReducer(
      initialState,
      promptUsageRecorded("run the build", Date.UTC(2026, 0, 2)),
    );

    expect(state.promptUsage).toEqual([
      { text: "run the build", count: 1, lastUsedAt: "2026-01-02T00:00:00.000Z" },
    ]);
  });

  it("ignores blank prompt submissions", () => {
    const state = hardwareConsoleReducer(initialState, promptUsageRecorded("   "));

    expect(state).toBe(initialState);
  });

  it("opens, retargets, and closes the radial picker overlay", () => {
    const opened = hardwareConsoleReducer(
      initialState,
      radialPromptPickerOpened(["a", "b"], 1),
    );
    expect(opened.radialPrompt).toEqual({ open: true, prompts: ["a", "b"], sector: 1 });

    const moved = hardwareConsoleReducer(opened, radialPromptPickerSectorChanged(null));
    expect(moved.radialPrompt).toEqual({ open: true, prompts: ["a", "b"], sector: null });

    const closed = hardwareConsoleReducer(moved, radialPromptPickerClosed());
    expect(closed.radialPrompt).toEqual({ open: false, prompts: [], sector: null });
  });

  it("ignores sector changes and closes while the overlay is closed", () => {
    expect(hardwareConsoleReducer(initialState, radialPromptPickerSectorChanged(2))).toBe(
      initialState,
    );
    expect(hardwareConsoleReducer(initialState, radialPromptPickerClosed())).toBe(initialState);
  });

  it("shows and hides the encoder cycling HUD", () => {
    const shown = hardwareConsoleReducer(initialState, encoderHudShown("ws-1"));
    expect(shown.encoderHudWorkspaceId).toBe("ws-1");

    const retargeted = hardwareConsoleReducer(shown, encoderHudShown("ws-2"));
    expect(retargeted.encoderHudWorkspaceId).toBe("ws-2");

    const hidden = hardwareConsoleReducer(retargeted, encoderHudHidden());
    expect(hidden.encoderHudWorkspaceId).toBeNull();
  });

  it("returns the same state for redundant HUD updates", () => {
    const shown = hardwareConsoleReducer(initialState, encoderHudShown("ws-1"));
    expect(hardwareConsoleReducer(shown, encoderHudShown("ws-1"))).toBe(shown);
    expect(hardwareConsoleReducer(initialState, encoderHudHidden())).toBe(initialState);
    expect(hardwareConsoleReducer(initialState, encoderHudShown(""))).toBe(initialState);
  });

  it("shows and hides the action-key HUD label", () => {
    const shown = hardwareConsoleReducer(
      initialState,
      actionHudShown("Cycle in-progress agents"),
    );
    expect(shown.actionHudLabel).toBe("Cycle in-progress agents");

    const relabeled = hardwareConsoleReducer(shown, actionHudShown("Cycle idle agents"));
    expect(relabeled.actionHudLabel).toBe("Cycle idle agents");

    const hidden = hardwareConsoleReducer(relabeled, actionHudHidden());
    expect(hidden.actionHudLabel).toBeNull();
  });

  it("returns the same state for redundant action HUD updates", () => {
    const shown = hardwareConsoleReducer(initialState, actionHudShown("Cycle idle agents"));
    expect(hardwareConsoleReducer(shown, actionHudShown("Cycle idle agents"))).toBe(shown);
    expect(hardwareConsoleReducer(initialState, actionHudHidden())).toBe(initialState);
    expect(hardwareConsoleReducer(initialState, actionHudShown(""))).toBe(initialState);
  });

  it("defaults the per-model action mappings to each model's layout, unhydrated", () => {
    expect(initialState.actionMappingByModel["creator-micro-2"]).toEqual([
      "new-workspace",
      "new-agent",
      "see-spec",
      "switch-window-layouts",
      "cycle-in-progress-agents",
      "cycle-attention-agents",
      "cycle-unread-agents",
    ]);
    expect(initialState.actionMappingByModel["codex-micro"]).toEqual([
      "cycle-in-progress-agents",
      "cycle-attention-agents",
      "stop-agent",
      "new-workspace",
      "cycle-unread-agents",
      "none",
      "new-agent",
    ]);
    expect(initialState.actionMappingHydrated).toBe(false);
  });

  it("hydrates the per-model mappings (normalized to 7 slots) and marks hydrated", () => {
    const state = hardwareConsoleReducer(
      initialState,
      hydrateHardwareConsoleActionMapping({ "creator-micro-2": ["none"] } as never),
    );

    expect(state.actionMappingByModel["creator-micro-2"]).toEqual([
      "none",
      "new-agent",
      "see-spec",
      "switch-window-layouts",
      "cycle-in-progress-agents",
      "cycle-attention-agents",
      "cycle-unread-agents",
    ]);
    expect(state.actionMappingByModel["codex-micro"]).toEqual(
      initialState.actionMappingByModel["codex-micro"],
    );
    expect(state.actionMappingHydrated).toBe(true);
  });

  it("assigns an action to a slot for one model only", () => {
    const state = hardwareConsoleReducer(
      initialState,
      setActionKeyMapping("creator-micro-2", 0, "none"),
    );

    expect(state.actionMappingByModel["creator-micro-2"][0]).toBe("none");
    expect(state.actionMappingByModel["creator-micro-2"].slice(1)).toEqual(
      initialState.actionMappingByModel["creator-micro-2"].slice(1),
    );
    expect(state.actionMappingByModel["codex-micro"]).toEqual(
      initialState.actionMappingByModel["codex-micro"],
    );
  });

  it("accepts assignments to the Codex linked-pair slot (separable pair)", () => {
    const state = hardwareConsoleReducer(
      initialState,
      setActionKeyMapping("codex-micro", 5, "new-agent"),
    );
    expect(state.actionMappingByModel["codex-micro"][5]).toBe("new-agent");
    expect(state.actionMappingByModel["creator-micro-2"]).toEqual(
      initialState.actionMappingByModel["creator-micro-2"],
    );
  });

  it("ignores out-of-range action slots and no-op reassignments", () => {
    expect(
      hardwareConsoleReducer(initialState, setActionKeyMapping("creator-micro-2", -1, "none")),
    ).toBe(initialState);
    expect(
      hardwareConsoleReducer(initialState, setActionKeyMapping("creator-micro-2", 7, "none")),
    ).toBe(initialState);
    expect(
      hardwareConsoleReducer(initialState, setActionKeyMapping("creator-micro-2", 2, "see-spec")),
    ).toBe(initialState);
  });

  it("defaults the cycle scopes to top-level except failed", () => {
    expect(initialState.cycleScopeByFamily).toEqual({
      "cycle-in-progress-agents": "top-level",
      "cycle-attention-agents": "top-level",
      "cycle-idle-agents": "top-level",
      "cycle-failed-agents": "all",
    });
  });

  it("hydrates cycle scopes, filling missing families with defaults", () => {
    const state = hardwareConsoleReducer(
      initialState,
      hydrateHardwareConsoleCycleScopes({ "cycle-in-progress-agents": "all" }),
    );
    expect(state.cycleScopeByFamily).toEqual({
      "cycle-in-progress-agents": "all",
      "cycle-attention-agents": "top-level",
      "cycle-idle-agents": "top-level",
      "cycle-failed-agents": "all",
    });
  });

  it("sets one family's cycle scope and no-ops on repeats", () => {
    const state = hardwareConsoleReducer(
      initialState,
      setCycleScope("cycle-idle-agents", "all"),
    );
    expect(state.cycleScopeByFamily["cycle-idle-agents"]).toBe("all");
    expect(state.cycleScopeByFamily["cycle-in-progress-agents"]).toBe("top-level");
    expect(hardwareConsoleReducer(state, setCycleScope("cycle-idle-agents", "all"))).toBe(state);
    expect(
      hardwareConsoleReducer(initialState, setCycleScope("cycle-failed-agents", "all")),
    ).toBe(initialState);
  });
});
