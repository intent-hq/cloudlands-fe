import { IPC_CHANNELS } from '$shared/ipc-registry';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { AgentSession } from '$shared/types';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
import type { ScriptMonitor } from '$features/script-monitor/types';
import { store as appStore } from '$store/renderer/store';
import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { backgroundHooksUpdated } from '$store/renderer/slices/background-hooks/background-hooks-slice';
import { prMonitorsUpdated } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
import { scriptMonitorsUpdated } from '$store/renderer/slices/script-monitor/script-monitor-slice';
import { refreshWorkspaceSubscriptionEntriesRequested } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { agentSubscriptionReadSaga } from '$store/renderer/slices/agent-subscription-ui/sagas/agent-subscription-read-saga';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  daemonEventsSubscribed,
  daemonEventsSubscribing,
} from '$store/renderer/slices/workspace-events/workspace-events-slice';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';

interface ActivityWireCall {
  method: string;
  params: Record<string, unknown>;
}
interface ActivityBrowserControl {
  calls: ActivityWireCall[];
  held: boolean;
  maxConcurrent: number;
  seed: (threads: AgentSession[]) => void;
  settle: (agentId: string) => void;
  setEventCount: (agentId: string, count: number) => void;
  holdNextRead: (agentId: string) => void;
  release: () => void;
  refresh: (agentId: string) => void;
  reconnectWithEventCount: (agentId: string, count: number) => void;
}
declare global {
  interface Window {
    __homeAssistantActivity?: ActivityBrowserControl;
  }
}

export function setupHomeAssistantActivityFixtures() {
  const previous = window.electronAPI;
  if (!previous) throw new Error('Home preview bridge is unavailable');
  const calls: ActivityWireCall[] = [];
  const eventCounts = new Map<string, number>();
  const watchCounts = new Map<string, number>();
  const inFlight = new Map<string, number>();
  let hooks: BackgroundHook[] = [];
  let prs: PrMonitorRow[] = [];
  let scripts: ScriptMonitor[] = [];
  let heldAgentId: string | undefined;
  let release = () => {};
  const createdAt = '2026-09-29T12:00:00Z';
  const expiresAt = '2026-09-30T12:00:00Z';
  const id = (index: number) => `home-assistant-${index}`;
  const hook = (index: number, hookId: string, state: BackgroundHook['state']): BackgroundHook => ({
    hookId,
    workspaceId: CHIEF_WORKSPACE_ID,
    agentId: id(index),
    name: `Check release ${hookId}`,
    state,
    createdAt,
    expiresAt,
    delayMs: 600_000,
    nextRunAt: expiresAt,
    runCount: 1,
  });
  const pr = (index: number, state: PrMonitorRow['state']): PrMonitorRow => ({
    monitorId: `activity-pr-${index}`,
    workspaceId: CHIEF_WORKSPACE_ID,
    agentId: id(index),
    repo: 'acme/studio',
    prNumber: 142 + index,
    state,
    pendingChanges: [],
    hasPendingChanges: false,
    createdAt,
    updatedAt: createdAt,
  });
  const script = (index: number): ScriptMonitor => ({
    monitorId: `activity-script-${index}`,
    workspaceId: CHIEF_WORKSPACE_ID,
    agentId: id(index),
    scriptId: `activity-command-${index}`,
    runId: `activity-run-${index}`,
    scriptName: 'Check release readiness',
    mode: 'command',
    state: 'active',
    createdAt,
    expiresAt,
  });
  const publishActivity = () => {
    appStore.dispatch(backgroundHooksUpdated(CHIEF_WORKSPACE_ID, hooks));
    appStore.dispatch(prMonitorsUpdated(CHIEF_WORKSPACE_ID, prs));
    appStore.dispatch(
      scriptMonitorsUpdated(CHIEF_WORKSPACE_ID, {
        monitors: scripts,
        scripts: [],
        status: 'ready',
      }),
    );
  };
  const refresh = (agentId: string) =>
    appStore.dispatch(refreshWorkspaceSubscriptionEntriesRequested(CHIEF_WORKSPACE_ID, agentId));
  const snapshot = (agentId: string) => ({
    subscriptions: Array.from({ length: watchCounts.get(agentId) ?? 0 }, (_, index) => ({
      id: `${agentId}-watch-${index}`,
      agentId,
      workspaceId: CHIEF_WORKSPACE_ID,
      agentName: 'Assistant',
      eventTypes: ['agent:idle', 'agent:failed', 'agent:deleted'],
      actorIds: [`activity-child-${index}`],
      createdAt,
      description: 'Waiting for a specialist',
      delegationGroup: null,
    })),
    delegationGroups: [],
    agentStatuses: {},
    agents: [],
    eventSubscriptions: Array.from({ length: eventCounts.get(agentId) ?? 0 }, (_, index) => ({
      id: `${agentId}-events-${index}`,
      workspaceId: 'home-running',
      subscriberAgentId: agentId,
      eventTypes: ['note:*'],
      excludeSelf: true,
      batchWindow: 500,
      createdAt,
    })),
  });
  const control: ActivityBrowserControl = {
    calls,
    held: false,
    maxConcurrent: 0,
    seed(threads) {
      hooks = [
        hook(0, 'mixed-1', 'scheduled'),
        hook(0, 'mixed-2', 'running'),
        hook(1, 'hook-only', 'scheduled'),
        hook(8, 'long-title', 'scheduled'),
      ];
      for (const state of ['cancelled', 'dispatched', 'expired', 'evicted'] as const)
        hooks.push(hook(6, `settled-${state}`, state));
      prs = [pr(0, 'active'), pr(2, 'active'), pr(6, 'completed'), pr(8, 'active')];
      const settled = script(6);
      scripts = [
        script(0),
        script(3),
        {
          ...settled,
          state: 'completed',
          settledAt: expiresAt,
          reason: 'finished',
          result: { outcome: 'succeeded', stoppedAt: expiresAt, exitCode: 0 },
        },
      ];
      for (const thread of threads) {
        eventCounts.set(
          thread.id,
          [
            'home-assistant-0',
            'home-assistant-4',
            'home-assistant-8',
            'home-assistant-239',
          ].includes(thread.id)
            ? 1
            : 0,
        );
        watchCounts.set(thread.id, thread.id === id(5) ? 1 : 0);
        const index = Number(String(thread.id).split('-').at(-1));
        const names = [
          'Coordinate the release',
          'Check the shipped build',
          'Monitor a pull request',
          'Wait for browser checks',
          'Watch workspace changes',
          'Wait for a specialist',
          'Finished background work',
          'A quiet conversation',
          'Keep watching this release while I review the workspace details and check the deployment notes',
        ];
        const name = names[index] ?? thread.name;
        appStore.dispatch(
          updateSession(thread.id, {
            name,
            messages: thread.messages.map((message) =>
              message.role === 'user'
                ? { ...message, contentBlocks: [{ type: 'text', text: name }] }
                : message,
            ),
            isResponding: index === 0,
            isProcessing: false,
            isStreaming: false,
            isWaitingForOtherAgents: index === 5,
            waitingForAgentIds: index === 5 ? ['activity-child-0'] : [],
            waitingOnHooks: hooks
              .filter(
                (item) =>
                  item.agentId === thread.id &&
                  (item.state === 'scheduled' || item.state === 'running'),
              )
              .map(({ hookId, name }) => ({ hookId, name })),
            waitingOnPrMonitors: prs
              .filter((item) => item.agentId === thread.id && item.state === 'active')
              .map(({ monitorId, repo, prNumber }) => ({ monitorId, repo, prNumber })),
            waitingOnScriptMonitors: scripts
              .filter((item) => item.agentId === thread.id && item.state === 'active')
              .map(({ monitorId, scriptId, runId, scriptName, expiresAt }) => ({
                monitorId,
                scriptId,
                runId,
                scriptName,
                expiresAt,
              })),
          }),
        );
      }
      publishActivity();
    },
    settle(agentId) {
      hooks = hooks.map((item) =>
        item.agentId === agentId ? { ...item, state: 'cancelled' } : item,
      );
      prs = prs.map((item) => (item.agentId === agentId ? { ...item, state: 'completed' } : item));
      scripts = scripts.map((item) =>
        item.agentId === agentId
          ? { ...item, state: 'cancelled', reason: 'unmonitored', settledAt: expiresAt }
          : item,
      );
      eventCounts.set(agentId, 0);
      watchCounts.set(agentId, 0);
      appStore.dispatch(
        updateSession(agentId, {
          isWaitingForOtherAgents: false,
          waitingForAgentIds: [],
          isResponding: false,
        }),
      );
      publishActivity();
      refresh(agentId);
    },
    setEventCount(agentId, count) {
      eventCounts.set(agentId, count);
      refresh(agentId);
    },
    holdNextRead(agentId) {
      heldAgentId = agentId;
    },
    release() {
      release();
    },
    refresh,
    reconnectWithEventCount(agentId, count) {
      eventCounts.set(agentId, count);
      appStore.dispatch(backendReconnected());
      appStore.dispatch(daemonEventsSubscribing());
      appStore.dispatch(daemonEventsSubscribed());
      admitLegacyPrincipal();
    },
  };
  window.__homeAssistantActivity = control;
  window.electronAPI = {
    ...previous,
    invoke: async (channel: string, payload?: unknown) => {
      const request = payload as { method?: string; params?: Record<string, unknown> };
      if (channel !== IPC_CHANNELS.BACKEND.REQUEST || request?.method !== 'agent.getSubscriptions')
        return previous.invoke(channel, payload);
      const params = request.params;
      if (!params) throw new Error('Thread activity request params are missing');
      calls.push({ method: request.method, params: { ...params } });
      const agentId = String(params.agentId);
      const result = snapshot(agentId);
      const count = (inFlight.get(agentId) ?? 0) + 1;
      inFlight.set(agentId, count);
      control.maxConcurrent = Math.max(control.maxConcurrent, count);
      try {
        if (heldAgentId === agentId) {
          heldAgentId = undefined;
          control.held = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          control.held = false;
        }
        return { ok: true, result };
      } finally {
        inFlight.set(agentId, (inFlight.get(agentId) ?? 1) - 1);
      }
    },
  } as Window['electronAPI'];
  const stop = appStore.runSaga(agentSubscriptionReadSaga);
  return () => {
    stop();
    release();
    window.electronAPI = previous;
    delete window.__homeAssistantActivity;
  };
}
