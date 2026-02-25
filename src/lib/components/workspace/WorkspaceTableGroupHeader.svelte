<script lang="ts">
  /**
   * WorkspaceTableGroupHeader - Header row for a repository group in the workspace table
   */
  import Fa from 'svelte-fa';
  import { faFolder, faPlus, faBoxArchive, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Button from '../ui/button/button.svelte';

  interface Props {
    label: string;
    isGithub: boolean;
    owner?: string;
    isCollapsed: boolean;
    onToggle: () => void;
    onNew: () => void;
    onBulkArchive?: () => void;
    onBulkDeleteArchived?: () => void;
  }

  let {
    label,
    isGithub,
    owner,
    isCollapsed,
    onToggle,
    onNew,
    onBulkArchive,
    onBulkDeleteArchived,
  }: Props = $props();

  const isDev = import.meta.env.DEV;

  // Get GitHub avatar URL for org/user
  function getGitHubAvatarUrl(ownerName: string, size: number = 32): string {
    return `https://github.com/${ownerName}.png?size=${size}`;
  }
</script>

<div
  class="group/header relative flex items-center justify-between w-full {isCollapsed
    ? ''
    : 'border-b border-border/40'}"
>
  <button
    class="relative flex items-center gap-2.5 flex-1 h-10 px-4.5 text-left hover:bg-muted/30 transition-colors cursor-pointer"
    onclick={onToggle}
  >
    {#if isGithub && owner}
      <img
        src={getGitHubAvatarUrl(owner, 32)}
        alt={owner}
        class="w-5 h-5 rounded-full"
        loading="lazy"
      />
    {:else}
      <span class="text-muted-foreground/50">
        <Fa icon={faFolder} size="sm" />
      </span>
    {/if}
    <span class="flex-1 text-[13px] font-medium text-muted-foreground/75">{label}</span>
  </button>
  <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0">
    {#if isDev}
      {#if onBulkArchive}
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            onBulkArchive?.();
          }}
          class="opacity-20 group-hover/header:opacity-100 transition-opacity hover:text-muted-foreground"
          aria-label="Archive all spaces in this repo"
          tooltip="Archive all spaces in this repo"
        >
          <Fa icon={faBoxArchive} size="sm" />
        </Button>
      {/if}
      {#if onBulkDeleteArchived}
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            onBulkDeleteArchived?.();
          }}
          class="opacity-20 group-hover/header:opacity-100 transition-opacity hover:text-destructive-foreground hover:!bg-destructive/10"
          aria-label="Delete all archived spaces in this repo"
          tooltip="Delete all archived spaces in this repo"
        >
          <Fa icon={faTrash} size="sm" />
        </Button>
      {/if}
    {/if}
    <!-- Add new -->
    <Button
      variant="ghost-light"
      size="icon-sm"
      class="hover:text-foreground"
      onclick={(e: MouseEvent) => {
        e.stopPropagation();
        onNew();
      }}
    >
      <Fa icon={faPlus} size="sm" />
    </Button>
  </div>
</div>
