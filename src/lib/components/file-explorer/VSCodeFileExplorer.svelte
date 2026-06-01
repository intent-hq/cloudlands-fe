<script lang="ts">
  import VSCodeScrollablePanel from '../ui/VSCodeScrollablePanel.svelte';
  import FileTreeView from './file-tree-view.svelte';
  import { Button } from '$lib/components/ui/button';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import Fa from 'svelte-fa';
  import { faCodeBranch } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    workspaceId: string;
    onFileSelect?: (path: string) => void;
    onSelectAgent?: (agentId: string) => void;
    selectedFile?: string;
    isLoading?: boolean;
    class?: string;
    collapsed?: boolean;
    onCollapse?: () => void;
  }

  let {
    workspaceId,
    onFileSelect,
    onSelectAgent,
    selectedFile = $bindable(''),
    isLoading = false,
    class: className = '',
    collapsed = undefined,
    onCollapse = undefined,
  }: Props = $props();

  let showOnlyChanged = $state(false);
</script>

<VSCodeScrollablePanel
  title="Code"
  collapsible={true}
  {collapsed}
  {onCollapse}
  storageKey={collapsed === undefined ? 'workspace-files-collapsed' : undefined}
  class="h-full {className}"
>
  {#snippet headerActions()}
    <TooltipShortcut
      label={showOnlyChanged ? 'Show all files' : 'Show only changed files'}
      side="bottom"
    >
      <Button
        size="icon-xs"
        variant={showOnlyChanged ? 'default' : 'ghost'}
        onclick={() => (showOnlyChanged = !showOnlyChanged)}
        class="opacity-60 hover:opacity-100 {showOnlyChanged ? 'bg-primary/20 text-primary' : ''}"
      >
        <Fa icon={faCodeBranch} size="xs" />
      </Button>
    </TooltipShortcut>
  {/snippet}

  <FileTreeView
    {workspaceId}
    {onFileSelect}
    {onSelectAgent}
    bind:selectedFile
    {isLoading}
    {showOnlyChanged}
  />
</VSCodeScrollablePanel>
