<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import HomeWorkspaceChat from './HomeWorkspaceChat.svelte';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { selectWorkspaceDetailHydrated } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectActiveAgentId,
    selectAllWorkspaceAgents,
    resolveCanonicalInitialAgent,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { setActiveAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { goto } from '$app/navigation';
  import { Button } from '$lib/components/ui/button';
  import { Select } from '$lib/components/ui/select';
  import Fa from 'svelte-fa';
  import { faXmark, faChevronDown, faFolder } from '@fortawesome/free-solid-svg-icons';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { store } from '$store/renderer/store';
  import { ensureWorkspaceDetail } from '$features/workspace/workspace-detail-hydration';
  import { m } from '$shared/paraglide/messages.js';
  import type { Workspace } from '$shared/types';

  let {
    workspace,
    onclose,
    preview = false,
  }: {
    workspace: Workspace;
    onclose: () => void;
    preview?: boolean;
  } = $props();
  // Home keys this panel by workspace ID, matching the chat's subscription lifetime.
  const workspaceId = untrack(() => workspace.id);
  const agents$ = selectAllWorkspaceAgents(workspaceId);
  const activeId$ = selectActiveAgentId(workspaceId);
  const agents = $derived(
    $agents$.filter(
      (agent) => !agent.retiredAt && !agent.pendingDeleteAt && agent.status !== 'deleted',
    ),
  );
  const activeAgent = $derived(
    agents.find((agent) => agent.id === $activeId$) ?? resolveCanonicalInitialAgent(agents),
  );
  const repositoryLabel = $derived(
    [workspace.repositoryOwner, workspace.repositoryName].filter(Boolean).join('/'),
  );
  let detailFailed = $state(false);
  async function loadDetail() {
    detailFailed = false;
    try {
      await ensureWorkspaceDetail(workspace.id);
      detailFailed = !selectWorkspaceDetailHydrated.select(store.state, workspace.id);
    } catch {
      detailFailed = true;
    }
  }
  onMount(() => {
    if (!preview) void loadDetail();
  });
  function openWorkspace() {
    store.dispatch(openWorkspaceTab(workspace.id));
    void goto(`/workspace/${encodeURIComponent(workspace.id)}`);
  }
</script>

<section
  class="flex h-full min-h-0 min-w-0 flex-col"
  aria-label={m.home_workspace_details()}
  data-home-detail
>
  <header class="shrink-0 border-b border-border px-4 py-2">
    <div class="flex min-w-0 items-center gap-3">
      <h2 class="-ml-2 min-w-0 flex-1">
        <Button
          variant="ghost"
          class="type-title h-auto max-w-full justify-start px-2 py-1 text-left font-medium leading-snug"
          wrapContent={false}
          aria-label={m.home_open_workspace()}
          title={workspace.title}
          onclick={openWorkspace}
        >
          <span class="min-w-0 line-clamp-2 break-words">{workspace.title}</span>
        </Button>
      </h2>
      {#if repositoryLabel}
        <div
          class="flex min-w-0 max-w-[32%] items-center gap-1.5 type-caption text-muted-foreground"
          data-home-detail-repository
          title={repositoryLabel}
          aria-label={repositoryLabel}
        >
          {#if workspace.repositoryOwner}
            <GitHubAvatar
              identity={workspace.repositoryOwner}
              size={16}
              class="shrink-0 rounded-sm"
            />
          {:else}
            <Fa icon={faFolder} />
          {/if}
          <span class="home-detail-repository-name truncate">{repositoryLabel}</span>
        </div>
      {/if}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={m.home_close_preview()}
        title={m.home_close_preview()}
        onclick={onclose}><Fa icon={faXmark} /></Button
      >
    </div>
    {#if workspace.statusMessage}
      <p
        class="type-caption line-clamp-2 break-words leading-snug text-muted-foreground"
        title={workspace.statusMessage}
      >
        {workspace.statusMessage}
      </p>
    {/if}
    {#if agents.length}
      <div class="-ml-3 mt-2 min-w-0" data-home-agent-switcher>
        <Select.Root
          value={activeAgent?.id ?? ''}
          onchange={(value) => {
            const agent = agents.find((candidate) => candidate.id === value);
            if (agent) store.dispatch(setActiveAgentId(workspaceId, agent.id));
          }}
        >
          <Select.Trigger
            variant="ghost"
            class="h-8 w-fit max-w-full justify-start"
            aria-label={m.home_agents()}
          >
            {#if activeAgent}
              <AgentAvatar
                agentId={activeAgent.id}
                specialist={activeAgent.metadata?.specialist ??
                  activeAgent.agentMetadata?.specialist}
                variant="emphasized"
              />
            {/if}
            <span class="min-w-0 truncate text-left">{activeAgent?.name}</span>
            <Fa icon={faChevronDown} class="shrink-0 text-muted-foreground" />
          </Select.Trigger>
          <Select.Content portal>
            {#each agents as agent (agent.id)}
              <Select.Item value={agent.id} label={agent.name}>
                <span class="flex min-w-0 items-center gap-2">
                  <AgentAvatar
                    agentId={agent.id}
                    specialist={agent.metadata?.specialist ?? agent.agentMetadata?.specialist}
                    variant="emphasized"
                  />
                  <span class="truncate">{agent.name}</span>
                </span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {/if}
  </header>
  {#if detailFailed}
    <div class="flex items-center gap-2 px-4 py-2 type-caption text-muted-foreground" role="status">
      <p>{m.home_detail_unavailable()}</p>
      <Button variant="outline" size="sm" onclick={loadDetail}>{m.home_retry()}</Button>
    </div>
  {/if}
  <div class="min-h-0 min-w-0 flex-1">
    {#key workspace.id}<HomeWorkspaceChat {workspace} {preview} />{/key}
  </div>
</section>

<style>
  @container home-panel (max-width: 600px) {
    .home-detail-repository-name {
      display: none;
    }
    [data-home-detail-repository] {
      flex-shrink: 0;
    }
  }
</style>
