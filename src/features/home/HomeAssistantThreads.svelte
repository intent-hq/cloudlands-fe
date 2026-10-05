<script lang="ts">
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { m } from '$shared/paraglide/messages.js';
  import { store } from '$store/renderer/store';
  import { setChiefActiveAgentId } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    selectChiefActiveAgentId,
    selectChiefThreads,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { setActiveAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  const threads$ = selectChiefThreads();
  const activeAgentId$ = selectChiefActiveAgentId();
  let selectedKeys = $derived($activeAgentId$ ? [$activeAgentId$] : []);

  function chooseThread(agentId: string) {
    selectedKeys = [agentId];
    store.dispatch(setChiefActiveAgentId(agentId));
    store.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, agentId));
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
  class="min-h-0 flex-1"
>
  {#snippet row({ item: thread })}
    <ListRow class="min-h-9 px-2 py-2">
      {#snippet title()}<span title={thread.title}>{thread.title}</span>{/snippet}
      {#snippet trailing()}
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
