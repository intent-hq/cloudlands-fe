<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { createChiefThreadStarter } from '$lib/components/layout/sidebar-nav/cards/chief-thread-starter.svelte';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { setChiefActiveAgentId } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    selectChiefActiveAgentId,
    selectChiefThreads,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { selectHidesAgentLifecycleActions } from '$store/renderer/slices/workspace/workspace-selectors';
  import { setActiveAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
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
  const hidesThreadActions$ = selectHidesAgentLifecycleActions(CHIEF_WORKSPACE_ID);
  const threadStarter = createChiefThreadStarter();
  const selectedKeys = $derived($activeAgentId$ ? [$activeAgentId$] : []);

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
    appStore.dispatch(setChiefActiveAgentId(agentId));
    appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, agentId));
  }

  function startThread() {
    if (!$hidesThreadActions$) threadStarter.start();
  }
</script>

{#if !$hidesThreadActions$}
  <Button
    variant="ghost"
    class="mb-3 h-9 w-full shrink-0 justify-start gap-2 px-2 text-muted-foreground hover:text-foreground focus-visible:-outline-offset-1"
    labelClass="text-left"
    aria-disabled={threadStarter.pending || undefined}
    aria-busy={threadStarter.pending || undefined}
    onclick={startThread}
  >
    {#snippet leadingIcon()}
      <span class="flex size-3 items-center justify-center [&_svg]:size-3" aria-hidden="true">
        {#if threadStarter.pending}
          <IntentMarkLoader size={12} />
        {:else}
          <Fa icon={faPlus} />
        {/if}
      </span>
    {/snippet}
    {m.home_new_chat()}
  </Button>
{/if}

<ListView
  items={$threads$}
  getKey={(thread) => thread.agentId}
  getText={(thread) => thread.title}
  selectable="single"
  {selectedKeys}
  onActivate={(thread) => chooseThread(thread.agentId)}
  ariaLabel={m.layout_chiefCard_threadPicker_ariaLabel()}
  virtualize
  rowHeight={36}
  class="min-h-0 flex-1"
>
  {#snippet row({ item: thread })}
    <ListRow class="min-h-9 px-2 py-2" role="group" aria-label={thread.title}>
      {#snippet title()}
        <span title={thread.title}>{thread.title}</span>
      {/snippet}
      {#snippet trailing()}
        <HomeAssistantThreadActivity agentId={thread.agentId} />
        {#if thread.isActive}
          <span
            class="size-1.5 shrink-0 rounded-full bg-primary"
            role="img"
            aria-label={m.layout_chiefCard_activeThread_ariaLabel()}
          ></span>
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
