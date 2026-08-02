import { store } from '../../store';
import {
  isKeyAssignableWorkspace,
  resolveKeySlots,
} from '$features/hardware-console/assignment/key-assignment';
import { selectWorkspaceItems } from '../workspace/workspace-selectors';

/** Whether the hardware-console integration is enabled (device panel toggle). */
export const selectHardwareConsoleEnabled = store.createSelector<[], boolean>(
  (state) => state.hardwareConsole.enabled,
);

/** Top-N surface of the radial prompt picker (device panel setting; clamped 1–12). */
export const selectPromptPickerLimit = store.createSelector<[], number>(
  (state) => state.hardwareConsole.promptPickerLimit,
);

/** Per-model 7-slot action-key mappings (slot 0 = action key ACT06). */
export const selectHardwareConsoleActionMappingsByModel = store.createSelector(
  (state) => state.hardwareConsole.actionMappingByModel,
);

/** Raw 6-slot pin array (slot 0 = agent key AG00). */
export const selectHardwareConsoleKeyPins = store.createSelector<[], (string | null)[]>(
  (state) => state.hardwareConsole.keyPins,
);

/**
 * Resolved 6-slot key assignment: pinned slots stable, unpinned slots
 * auto-filled with the most recently active assignable workspaces.
 */
export const selectHardwareConsoleKeySlots = store.createSelector<[], (string | null)[]>(
  (state) => {
    const workspaces = selectWorkspaceItems.select(state).filter(isKeyAssignableWorkspace);
    return resolveKeySlots(state.hardwareConsole.keyPins, workspaces);
  },
);

/** Slot index (0-based) a workspace is pinned to, or null when unpinned. */
export const selectWorkspacePinnedKeySlot = store.createSelector<
  [workspaceId: string],
  number | null
>((state, workspaceId) => {
  const slot = state.hardwareConsole.keyPins.indexOf(workspaceId);
  return slot === -1 ? null : slot;
});

/**
 * Resolved slot index (0-based) a workspace currently occupies (pinned or
 * auto-filled), or null when it holds no slot.
 */
export const selectWorkspaceResolvedKeySlot = store.createSelector<
  [workspaceId: string],
  number | null
>((state, workspaceId) => {
  const slot = selectHardwareConsoleKeySlots.select(state).indexOf(workspaceId);
  return slot === -1 ? null : slot;
});

/** Joystick radial prompt picker overlay state (open flag, prompts, sector). */
export const selectHardwareConsoleRadialPrompt = store.createSelector(
  (state) => state.hardwareConsole.radialPrompt,
);

/** Workspace targeted by the encoder-rotate HUD; `null` = HUD hidden. */
export const selectEncoderHudWorkspaceId = store.createSelector(
  (state) => state.hardwareConsole.encoderHudWorkspaceId,
);
