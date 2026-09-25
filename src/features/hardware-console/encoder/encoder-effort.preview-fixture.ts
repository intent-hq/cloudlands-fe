import { store as appStore } from '$store/renderer/store';
import { AgentStatus } from '$shared/types/agent.types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { setActiveAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  openWorkspaceTab,
  loadWorkspaceTabsState,
  serializeWorkspaceTabsState,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { selectGuestSessions } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
import {
  encoderEffortHudShown,
  encoderHudHidden,
  hydrateHardwareConsoleEncoderBehavior,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { selectEncoderEffortTarget } from '$store/renderer/slices/hardware-console/hardware-console-selectors';

/** Frozen display fixture only; no persistence, device, or production sagas run. */
export function setupEncoderEffortPreview() {
  const workspaceId = WorkspaceId('encoder-preview-workspace');
  const agentId = AgentId('encoder-preview-agent');
  const previous = {
    tabs: serializeWorkspaceTabsState(appStore.state.tabState),
    behavior: appStore.state.hardwareConsole.encoderBehavior,
    guests: {
      sessions: selectGuestSessions.select(appStore.state),
      openIds: appStore.state.guestSessions.openIds,
      connectedIds: appStore.state.guestSessions.connectedIds,
    },
  };
  appStore.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
  appStore.dispatch(hydrateHardwareConsoleEncoderBehavior('agent-effort'));
  appStore.dispatch(openWorkspaceTab(workspaceId));
  appStore.dispatch(setActiveAgentId(workspaceId, agentId));
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId,
        backendSessionId: null,
        name: 'Preview agent',
        status: AgentStatus.Idle,
        provider: 'codex',
        model: 'preview-model',
        effortLevels: ['low', 'medium', 'high'],
        reasoningEffort: 'high',
        messages: [],
        createdAt: '2026-09-25T00:00:00Z',
        updatedAt: '2026-09-25T00:00:00Z',
      },
    ]),
  );
  const target = selectEncoderEffortTarget.select(appStore.state);
  if (target) appStore.dispatch(encoderEffortHudShown({ target, effort: 'high' }));
  return () => {
    appStore.dispatch(encoderHudHidden());
    appStore.dispatch(removeSession(agentId));
    appStore.dispatch(setActiveAgentId(workspaceId, null));
    appStore.dispatch(loadWorkspaceTabsState(previous.tabs));
    appStore.dispatch(guestSessionsListReceived(previous.guests));
    appStore.dispatch(hydrateHardwareConsoleEncoderBehavior(previous.behavior));
  };
}
