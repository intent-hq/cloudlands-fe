import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { buildLegacyReasoningEffortModelId } from '$features/agent/utils/legacy-reasoning-effort';
import { supportsReasoningEffortProtocol } from '$features/agent/utils/reasoning-effort-protocol';
import { selectCurrentWorkspaceTabId } from '../tab-state/tab-state-selectors';
import { selectActiveAgentId } from '../workspace-agents/workspace-agents-selectors';
import { selectAgentProvider } from '../agent-session/agent-session-selectors';
import { selectAgentModelEffortLevels, selectSelectedModel } from '../model/model-selectors';
import type { EncoderEffortTarget } from './hardware-console-types';

import { store } from '../../store';
import { buildHardwareLedSnapshot } from '$features/hardware-console/led/snapshot';
import {
  isKeyAssignableWorkspace,
  resolveKeySlots,
} from '$features/hardware-console/assignment/key-assignment';
import {
  selectIsWorkspaceCollaborator,
  selectWorkspaceItems,
} from '../workspace/workspace-selectors';

/** Whether the hardware-console integration is enabled (device panel toggle). */
export const selectHardwareConsoleEnabled = store.createSelector<[], boolean>(
  (state) => state.hardwareConsole.enabled,
);

/** Shared left-encoder behavior, read on each input so a choice applies immediately. */
export const selectHardwareConsoleEncoderBehavior = store.createSelector(
  (state) => state.hardwareConsole.encoderBehavior,
);

export const selectHardwareConsoleEncoderBehaviorSaveFailed = store.createSelector(
  (state) => state.hardwareConsole.encoderBehaviorSaveFailed,
);

/**
 * Whether this window owns the hardware console (last-focused non-HUD
 * window, intent-hq/monorepo#1928). Only the owner acts on decoded input.
 */
export const selectIsConsoleOwner = store.createSelector<[], boolean>(
  (state) => state.hardwareConsole.isConsoleOwner,
);

/** Top-N surface of the radial prompt picker (device panel setting; clamped 1–12). */
export const selectPromptPickerLimit = store.createSelector<[], number>(
  (state) => state.hardwareConsole.promptPickerLimit,
);

/** Per-model 7-slot action-key mappings (slot 0 = action key ACT06). */
export const selectHardwareConsoleActionMappingsByModel = store.createSelector(
  (state) => state.hardwareConsole.actionMappingByModel,
);

/** Per-family agent-cycle scopes (`all` includes sub-agents, `top-level` does not). */
export const selectHardwareConsoleCycleScopes = store.createSelector(
  (state) => state.hardwareConsole.cycleScopeByFamily,
);

/** Raw 6-slot pin array (slot 0 = agent key AG00). */
export const selectHardwareConsoleKeyPins = store.createSelector<[], (string | null)[]>(
  (state) => state.hardwareConsole.keyPins,
);

export const selectHardwareConsoleExcludedWorkspaceIds = store.createSelector<[], string[]>(
  (state) => state.hardwareConsole.excludedWorkspaceIds,
);

export const selectHardwareConsolePromptUsage = store.createSelector(
  (state) => state.hardwareConsole.promptUsage,
);

/**
 * Resolved 6-slot key assignment: pinned slots stable, unpinned slots
 * auto-filled with the most recently active assignable workspaces.
 */
export const selectHardwareConsoleKeySlots = store.createSelector<[], (string | null)[]>(
  (state) => {
    const workspaces = selectWorkspaceItems.select(state).filter(isKeyAssignableWorkspace);
    return resolveKeySlots(
      state.hardwareConsole.keyPins,
      workspaces,
      state.hardwareConsole.excludedWorkspaceIds,
    );
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

/** Title for the encoder-rotate HUD's current workspace target. */
export const selectEncoderHudWorkspaceTitle = store.createSelector((state): string | null => {
  const workspaceId = state.hardwareConsole.encoderHudWorkspaceId;
  if (workspaceId === null) return null;
  return (
    selectWorkspaceItems.select(state).find((workspace) => workspace.id === workspaceId)?.title ??
    null
  );
});

/** Label of the last-fired cycle action key shown by the action HUD; `null` = HUD hidden. */
export const selectActionHudLabel = store.createSelector(
  (state) => state.hardwareConsole.actionHudLabel,
);

/** True while a push-to-talk recording is in progress ("Listening…" indicator). */
export const selectPttRecording = store.createSelector(
  (state) => state.hardwareConsole.pttRecording,
);

/** True while a `voice.transcribe` request is in flight (mic-button spinner). */
export const selectVoiceTranscribing = store.createSelector(
  (state) => state.hardwareConsole.voiceTranscribing,
);

/** Derived six-key and ambient LED state for hardware-console device wiring. */
export const selectHardwareLedSnapshot = store.createSelector((state) =>
  buildHardwareLedSnapshot(state),
);

/** Also used after an await to guard rollback against a changed model or role. */
export const selectEditableEncoderAgent = store.createSelector(
  (state, workspaceId: string, agentId: string): EncoderEffortTarget | null => {
    const session = state.agentSessions.byAgentId[agentId];
    if (!session || session.workspaceId !== workspaceId) return null;
    if (selectIsWorkspaceCollaborator.select(state, workspaceId)) return null;
    const levels = selectAgentModelEffortLevels.select(state, agentId);
    if (!levels?.length) return null;
    const provider = selectAgentProvider.select(state, agentId);
    const model = session.model ?? selectSelectedModel.select(state, provider);
    const protocolVersion = state.daemonHealth.stats?.protocolVersion;
    // Legacy effort echoes change the suffix, not the selected base model.
    const modelIdentity =
      protocolVersion && !supportsReasoningEffortProtocol(protocolVersion)
        ? buildLegacyReasoningEffortModelId(model, null, levels)
        : model;
    return {
      key: JSON.stringify([workspaceId, agentId, provider, modelIdentity, levels]),
      workspaceId,
      agentId,
      levels,
    };
  },
);

/** Same selected workspace/agent convention as the hardware action keys. */
export const selectEncoderEffortTarget = store.createSelector(
  (state): EncoderEffortTarget | null => {
    const hardware = state.hardwareConsole;
    if (
      !hardware.enabled ||
      !hardware.isConsoleOwner ||
      !hardware.encoderBehaviorHydrated ||
      hardware.encoderBehavior !== 'agent-effort'
    )
      return null;
    const workspaceId = selectCurrentWorkspaceTabId.select(state);
    if (!workspaceId || workspaceId === CHIEF_WORKSPACE_ID) return null;
    const agentId = selectActiveAgentId.select(state, workspaceId);
    return agentId ? selectEditableEncoderAgent.select(state, workspaceId, agentId) : null;
  },
);

/** Never announce a failed write, another agent, or a replaced model's value. */
export const selectEncoderEffortFeedback = store.createSelector((state) => {
  const feedback = state.hardwareConsole.encoderEffortFeedback;
  if (!feedback || selectEncoderEffortTarget.select(state)?.key !== feedback.target.key)
    return null;
  const effort = state.agentSessions.byAgentId[feedback.target.agentId]?.reasoningEffort ?? null;
  return effort === feedback.effort ? feedback : null;
});
