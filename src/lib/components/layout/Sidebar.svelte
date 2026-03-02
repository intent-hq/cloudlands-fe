<script lang="ts">
  import Fa from 'svelte-fa';
  import { faPlus, faCog } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import Logo from '$lib/components/Logo.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import AgentsList from '$lib/components/chat/AgentsList.svelte';
  import WorkspaceLinks from '$lib/components/workspace/WorkspaceLinks.svelte';
  import type { Workspace } from '$shared/types';
  import type { AgentSession } from '$shared/types';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';

  interface Props {
    workspaces: Workspace[];
    agents: AgentSession[];
    onCreateWorkspace?: () => void;
    onCreateWorkspaceForRepo?: (repoName: string, lastWorkspace: Workspace) => void;
    onSelectAgent?: (agentId: string) => void;
  }

  let { workspaces, agents, onCreateWorkspace, onCreateWorkspaceForRepo, onSelectAgent }: Props =
    $props();
</script>

<!-- <ResizablePanel
  let:isCollapsed
  side="left"
  minWidth={48}
  maxWidth={400}
  defaultWidth={240}
  collapseThreshold={100}
  storageKey="sidebar-width"
> -->
<div class="w-12 h-full flex flex-col pr-4">
  <!-- Brand -->
  <div class="px-3 pt-14 pb-4 overflow-hidden">
    <!-- {#if !isCollapsed}
      <Logo width={21} />
    {:else} -->
    <div class="w-6 h-6 flex items-center justify-center">
      <Logo width={16} />
    </div>
    <!-- {/if} -->
  </div>

  <!-- Workspaces Section -->
  <!-- <div class="py-7 overflow-hidden">
      {#if !isCollapsed}
        <div class="pl-5 mb-1.5 flex justify-between items-center">
          <a href="/">
            <Header size={4}>Spaces</Header>
          </a>
          <Button
            variant="ghost-light"
            size="icon-xs"
            onclick={onCreateWorkspace}
            aria-label="Create new space"
          >
            <Fa icon={faPlus} size="xs" />
          </Button>
        </div>
      {:else}
        <div class="px-2 mb-1.5 flex justify-center">
          <Button
            variant="ghost-light"
            size="icon-sm"
            onclick={onCreateWorkspace}
            aria-label="Create new space"
            title="Create new space"
          >
            <Fa icon={faPlus} size="xs" />
          </Button>
        </div>
      {/if}

      <WorkspaceLinks
        {workspaces}
        collapsed={isCollapsed}
        {onCreateWorkspaceForRepo}
      />
    </div> -->

  <!-- Threads Section -->
  <!-- <AgentsList
      {agents}
      collapsed={isCollapsed}
      on:select={(e) => onSelectAgent?.(e.detail.agentId)}
    /> -->

  <!-- Settings link -->
  <div class="flex-none mt-auto pl-2 py-3">
    <Button
      variant="ghost-light"
      size="sm"
      class="w-full justify-start text-left px-3"
      onclick={() => navigateToSettings()}
    >
      <Fa icon={faCog} size="xs" class="text-ghost" />
    </Button>
  </div>
</div>
<!-- </ResizablePanel> -->
