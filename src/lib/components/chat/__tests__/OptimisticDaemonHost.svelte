<script module lang="ts">
  import type { selectAgentSubmissionDisplay as submissionDisplaySelector } from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
  declare global {
    interface Window {
      __optimisticDaemon?: {
        display: () => ReturnType<typeof submissionDisplaySelector.select>;
        submit: (text: string) => boolean;
        refresh: () => Promise<void>;
      };
    }
  }
</script>

<script lang="ts">
  /* eslint-disable intent/no-component-async-data-fetch -- Test-only bootstrap of the real daemon transport and production sagas; not an application component. */
  // Opt-in functional fixture. Every domain read/write below reaches the isolated daemon.
  import { onDestroy, onMount } from 'svelte';
  import { faComment } from '@fortawesome/free-solid-svg-icons';
  import AgentTabType from '$features/layout/tab-types/AgentTabType.svelte';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';
  import PanelLayout from '$lib/components/layout/panel-system/PanelLayout.svelte';
  import { appClient } from '$lib/client';
  import { backendRequest, onBackendNotification } from '$lib/client/live/backend-transport';
  import { parsePrincipalSnapshot } from '$shared/types/principal';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { getItems } from '@themislib/themis/utils/collections/collection-utils';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import { getPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-context';
  import {
    principalReceived,
    principalContextChanged,
  } from '$store/renderer/slices/principal/principal-slice';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    setWorkspaceEntity,
    setWorkspaceHasLoaded,
    replaceWorkspaceList,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
  import { selectWorkspaceParticipationContext } from '$store/renderer/slices/workspace/workspace-selectors';
  import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
  import { chatSendSaga } from '$store/renderer/slices/chat-state/sagas/chat-send-saga';
  import { chatReadSaga } from '$store/renderer/slices/chat-state/sagas/chat-read-saga';
  import { chatSubscribeSaga } from '$store/renderer/slices/chat-state/sagas/chat-subscribe-saga';
  import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
  import { selectAgentSubmissionDisplay } from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
  import { submitChatMessage } from '$features/agent/chat-submission';
  import { loadChatTranscript } from '$features/agent/chat-read-service';
  import { hydrateAgentQueue } from '$features/agent/agent-queue-read-service';

  const { wsUrl, workspaceId, agentId }: { wsUrl: string; workspaceId: string; agentId: string } =
    $props();
  (
    globalThis as typeof globalThis & { __INTENT_RUNTIME_CONFIG__?: object }
  ).__INTENT_RUNTIME_CONFIG__ = { intentdWsUrl: wsUrl };
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  const cleanups: (() => void)[] = [dispose];
  let ready = $state(false);
  let error = $state('');
  onMount(() => {
    void (async () => {
      const hello = await backendRequest('client.hello', {
        clientId: 'optimistic-browser-functional',
      });
      const principal = parsePrincipalSnapshot(hello, await backendRequest('principal.me', {}));
      if (!principal?.capabilities.submissionCorrelation)
        throw new Error('Daemon lacks submission correlation');
      // Bootstrap only connection ownership. Identity/capabilities come from authenticated reads.
      const connections = store.state.connections;
      store.dispatch(
        connectionsListReceived({
          connections: getItems(connections.connections),
          activeId: connections.activeId,
          windowBackendId: connections.windowBackendId,
        }),
      );
      store.dispatch(connectionStatusChanged('connected'));
      store.dispatch(daemonEventsSubscribed());
      store.dispatch(principalContextChanged(getPrincipalConnectionContext(store.state)));
      const current = store.state.principal;
      store.dispatch(
        principalReceived(
          {
            context: current.context!,
            invalidation: current.invalidation,
            presentationVersion: current.presentationVersion,
          },
          principal,
        ),
      );
      const workspaces = await appClient.workspaces.list();
      store.dispatch(replaceWorkspaceList(workspaces));
      store.dispatch(
        setWorkspaceHasLoaded(
          true,
          store.state.connections.windowBackendId,
          selectPrincipalActionContext.select(store.state),
        ),
      );
      const workspace = await appClient.workspaces.get(workspaceId);
      if (!workspace) throw new Error('Missing isolated workspace');
      store.dispatch(setWorkspaceEntity(workspace));
      const session = await appClient.agents.get(agentId, workspaceId);
      if (!session) throw new Error('Missing isolated agent');
      store.dispatch(bulkUpsertSessions([session]));
      store.dispatch(setAgents(workspaceId, [session]));
      const sub = await backendRequest<{ subscriptionId: string }>('events.subscribe', {
        workspaceId,
        eventTypes: ['agent:*'],
      });
      cleanups.push(
        onBackendNotification((n) =>
          routeDaemonEventsNotification(n.method, n.params, sub.subscriptionId),
        ),
      );
      cleanups.push(
        ...[agentMutationSaga, chatSendSaga, chatReadSaga, chatSubscribeSaga].map((saga) =>
          store.runSaga(saga),
        ),
      );
      tabTypeRegistry.register({
        type: 'agent',
        component: AgentTabType,
        icon: faComment,
        defaultTitle: 'Agent',
        categoryLabel: 'Agents',
        defaultWidthTier: 'narrow',
        sidebarTabId: 'agents',
        renameable: true,
      });
      store.dispatch(
        initializeLayout(workspaceId, {
          root: { type: 'panel', panelId: 'live-chat' },
          panels: {
            'live-chat': {
              id: 'live-chat',
              tabs: [
                {
                  id: 'live-agent',
                  type: 'agent',
                  title: session.name,
                  agentId,
                  workspaceId,
                  closable: true,
                },
              ],
              activeTabId: 'live-agent',
            },
          },
          focusedPanelId: 'live-chat',
        }),
      );
      store.dispatch(setRestoreStatus(workspaceId, 'restored'));
      window.__optimisticDaemon = {
        display: () =>
          structuredClone(selectAgentSubmissionDisplay.select(store.state, agentId, workspaceId)),
        submit: (text) => submitChatMessage(store, agentId, { wsId: workspaceId, text }),
        refresh: async () => {
          await hydrateAgentQueue(agentId, workspaceId);
          await loadChatTranscript(agentId, workspaceId);
        },
      };
      if (!selectWorkspaceParticipationContext.select(store.state, workspaceId))
        throw new Error('Fixture did not establish authenticated participation');
      ready = true;
    })().catch((e) => {
      error = String(e);
    });
  });
  onDestroy(() => {
    cleanups.reverse().forEach((stop) => stop());
    delete window.__optimisticDaemon;
  });
</script>

{#if error}<p role="alert">{error}</p>{/if}
{#if ready}
  <section data-testid="optimistic-daemon" class="relative h-[720px] w-[800px]">
    <PanelLayout {workspaceId} layoutId={workspaceId} />
  </section>
{:else}<p>Connecting isolated functional fixture…</p>{/if}
