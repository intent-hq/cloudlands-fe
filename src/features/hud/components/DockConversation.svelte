<script lang="ts">
  import DockConversationPanel from './DockConversationPanel.svelte';
  import DockConversationComposer, {
    type DockConversationComposerSubmission,
  } from './DockConversationComposer.svelte';
  import { getPresentedUserMessageText } from '$lib/utils/user-message-presentation';
  import { isAutomatedChatMessage } from '$lib/utils/previous-user-message';
  import type { ContextItem } from '$lib/components/chat/input/context-api';
  import { agentSessionStopChatRequested } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectDockConversationView,
    selectDockConversationComposer,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import {
    closeDockConversationRequested,
    selectDockConversationAgentRequested,
    dockConversationDraftChanged,
    dockConversationContextItemsChanged,
    sendDockConversationRequested,
    retryDockConversationSendRequested,
    reloadDockConversationRequested,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';

  let {
    onOpenWorkspace,
  }: { onOpenWorkspace: (workspaceId: string, agentId: string | null) => void } = $props();
  const view$ = selectDockConversationView();
  const composer$ = selectDockConversationComposer();
  const historyNavigation = new Map<
    string,
    { index: number; draft: string; applied: string | null }
  >();

  function samePair(workspaceId: string, agentId: string): boolean {
    const current = selectDockConversationView.select(appStore.state);
    return current.workspaceId === workspaceId && current.agentId === agentId;
  }
  function changeComposerText(workspaceId: string, agentId: string, text: string): void {
    if (!samePair(workspaceId, agentId)) return;
    const key = JSON.stringify([workspaceId, agentId]);
    const navigation = historyNavigation.get(key);
    if (navigation?.applied === text) navigation.applied = null;
    else historyNavigation.delete(key);
    appStore.dispatch(dockConversationDraftChanged(workspaceId, agentId, text));
  }
  function changeContext(workspaceId: string, agentId: string, items: ContextItem[]): void {
    if (!samePair(workspaceId, agentId)) return;
    appStore.dispatch(
      dockConversationContextItemsChanged(
        workspaceId,
        agentId,
        items.map(({ file: _file, ...item }) => item),
      ),
    );
  }
  function submit(
    workspaceId: string,
    agentId: string,
    snapshot: DockConversationComposerSubmission,
  ): void {
    if (!samePair(workspaceId, agentId)) return;
    historyNavigation.delete(JSON.stringify([workspaceId, agentId]));
    appStore.dispatch(sendDockConversationRequested({ workspaceId, agentId, ...snapshot }));
  }
  function stop(workspaceId: string, agentId: string): void {
    if (
      !samePair(workspaceId, agentId) ||
      selectDockConversationView.select(appStore.state).draftDisabled
    )
      return;
    appStore.dispatch(agentSessionStopChatRequested(agentId));
  }
  function navigateHistory(workspaceId: string, agentId: string, direction: -1 | 1): string | null {
    if (!samePair(workspaceId, agentId)) return null;
    const view = selectDockConversationView.select(appStore.state);
    const history = view.messages
      .filter((row) => row.role === 'user' && !isAutomatedChatMessage(row))
      .map((row) => getPresentedUserMessageText(row, view.workspace?.ownerPrincipalId).trim())
      .filter(Boolean);
    if (!history.length) return null;
    const key = JSON.stringify([workspaceId, agentId]);
    const previous = historyNavigation.get(key);
    if (!previous && direction === 1) return null;
    const nav: { index: number; draft: string; applied: string | null } = previous ?? {
      index: history.length,
      draft: view.draft,
      applied: null,
    };
    nav.index = Math.max(0, Math.min(history.length, nav.index + direction));
    const text = nav.index === history.length ? nav.draft : history[nav.index];
    nav.applied = text;
    historyNavigation.set(key, nav);
    return text;
  }

  function changeDraft(text: string): void {
    const view = selectDockConversationView.select(appStore.state);
    if (view.workspaceId && view.agentId)
      appStore.dispatch(dockConversationDraftChanged(view.workspaceId, view.agentId, text));
  }
  function openWorkspace(): void {
    const view = selectDockConversationView.select(appStore.state);
    if (view.workspaceId) onOpenWorkspace(view.workspaceId, view.agentId);
  }
</script>

{#snippet composer()}
  {#if $composer$.workspace && $composer$.agentId}
    {@const workspaceId = $composer$.workspace.id}
    {@const agentId = $composer$.agentId}
    {#key JSON.stringify([workspaceId, agentId])}
      <DockConversationComposer
        {...$composer$}
        workspace={$composer$.workspace}
        {agentId}
        pending={$view$.sending}
        onValueChange={(text) => changeComposerText(workspaceId, agentId, text)}
        onContextItemsChange={(items) => changeContext(workspaceId, agentId, items)}
        onSubmit={(snapshot) => submit(workspaceId, agentId, snapshot)}
        onStop={() => stop(workspaceId, agentId)}
        onHistoryPrev={() => navigateHistory(workspaceId, agentId, -1)}
        onHistoryNext={() => navigateHistory(workspaceId, agentId, 1)}
      />
    {/key}
  {/if}
{/snippet}

<DockConversationPanel
  {composer}
  {...$view$}
  conversationKey={JSON.stringify([$view$.workspaceId, $view$.agentId])}
  onDraftChange={changeDraft}
  onSend={() => appStore.dispatch(sendDockConversationRequested())}
  onRetrySend={() => appStore.dispatch(retryDockConversationSendRequested())}
  onSelectAgent={(id) => appStore.dispatch(selectDockConversationAgentRequested(id))}
  onBack={() => appStore.dispatch(closeDockConversationRequested())}
  onOpenWorkspace={openWorkspace}
  onRetryLoad={() => appStore.dispatch(reloadDockConversationRequested())}
/>
