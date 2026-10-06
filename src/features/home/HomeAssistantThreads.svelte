<script lang="ts">
  import { onMount } from 'svelte';
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/ui/button';
  import { faPen } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import AssistantThreadRenameDialog from '$lib/components/chat/AssistantThreadRenameDialog.svelte';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { setChiefActiveAgentId } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    selectChiefActiveAgentId,
    selectChiefThreads,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { setActiveAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { selectHidesAgentLifecycleActions } from '$store/renderer/slices/workspace/workspace-selectors';
  import type { ChiefThreadSummary } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import {
    backgroundHooksSubscribeRequested,
    backgroundHooksUnsubscribeRequested,
  } from '$store/renderer/slices/background-hooks/background-hooks-slice';
  import {
    prMonitorsSubscribeRequested,
    prMonitorsUnsubscribeRequested,
  } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
  import {
    scriptMonitorsSubscribeRequested,
    scriptMonitorsUnsubscribeRequested,
  } from '$store/renderer/slices/script-monitor/script-monitor-slice';
  import HomeAssistantThreadActivity from './HomeAssistantThreadActivity.svelte';

  const threads$ = selectChiefThreads();
  const activeAgentId$ = selectChiefActiveAgentId();
  const hidesActions$ = selectHidesAgentLifecycleActions(CHIEF_WORKSPACE_ID);
  let renaming = $state<{ thread: ChiefThreadSummary; returnFocus: HTMLButtonElement } | null>(
    null,
  );
  let selectedKeys = $derived($activeAgentId$ ? [$activeAgentId$] : []);

  onMount(() => {
    appStore.dispatch(backgroundHooksSubscribeRequested(CHIEF_WORKSPACE_ID));
    appStore.dispatch(prMonitorsSubscribeRequested(CHIEF_WORKSPACE_ID));
    appStore.dispatch(scriptMonitorsSubscribeRequested(CHIEF_WORKSPACE_ID));
    return () => {
      appStore.dispatch(backgroundHooksUnsubscribeRequested(CHIEF_WORKSPACE_ID));
      appStore.dispatch(prMonitorsUnsubscribeRequested(CHIEF_WORKSPACE_ID));
      appStore.dispatch(scriptMonitorsUnsubscribeRequested(CHIEF_WORKSPACE_ID));
    };
  });

  function chooseThread(agentId: string) {
    selectedKeys = [agentId];
    appStore.dispatch(setChiefActiveAgentId(agentId));
    appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, agentId));
  }
</script>

<ListView
  items={$threads$}
  getKey={(thread) => thread.agentId}
  getText={(thread) => thread.title}
  selectable="single"
  bind:selectedKeys
  onActivate={(thread) => chooseThread(thread.agentId)}
  ariaLabel={m.layout_chiefCard_threadPicker_ariaLabel()}
  virtualize
  rowHeight={36}
  class="min-h-0 flex-1"
>
  {#snippet row({ item: thread })}
    <ListRow class="min-h-9 px-2 py-2" role="group" aria-label={thread.title}>
      {#snippet title()}<span title={thread.title}>{thread.title}</span>{/snippet}
      {#snippet trailing()}
        <HomeAssistantThreadActivity agentId={thread.agentId} />
        {#if thread.isActive}
          <span
            class="size-1.5 shrink-0 rounded-full bg-primary"
            role="img"
            aria-label={m.layout_chiefCard_activeThread_ariaLabel()}
          ></span>
        {/if}
        {#if !$hidesActions$}
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label={m.layout_chiefCard_renameThread_ariaLabel({ title: thread.title })}
            title={m.layout_chiefCard_renameThread_title()}
            onclick={(event) => {
              if (event.currentTarget instanceof HTMLButtonElement)
                renaming = { thread, returnFocus: event.currentTarget };
            }}
          >
            <Fa icon={faPen} size="xs" />
          </Button>
        {/if}
      {/snippet}
    </ListRow>
  {/snippet}
  {#snippet empty()}
    <p role="status" class="px-2 py-3 type-caption text-muted-foreground">
      {m.layout_chiefCard_noThreads_label()}
    </p>
  {/snippet}
</ListView>

{#if renaming}
  <AssistantThreadRenameDialog {...renaming} onClose={() => (renaming = null)} />
{/if}
