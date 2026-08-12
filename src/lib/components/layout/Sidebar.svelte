<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCog } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import Logo from '$lib/components/Logo.svelte';
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
