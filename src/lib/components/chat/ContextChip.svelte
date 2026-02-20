<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faFileLines,
    faCodeBranch,
    faClipboard,
    faICursor,
    faFolder,
    faXmark,
    faTicket,
    faBug,
    faLink,
    faCodePullRequest,
  } from '@fortawesome/free-solid-svg-icons';
  import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import Button from '$lib/components/ui/button/button.svelte';

  interface Props {
    /** Type of context item */
    type:
      | 'file'
      | 'diff'
      | 'note'
      | 'spec'
      | 'selection'
      | 'folder'
      | 'workspace'
      | 'memory'
      | 'personality'
      | 'linear'
      | 'github'
      | 'sentry'
      | 'external';
    /** Display label */
    label: string;
    /** Optional custom icon (overrides type-based icon) */
    icon?: IconDefinition;
    /** Tooltip text */
    tooltip?: string;
    /** Max width for label truncation */
    maxLabelWidth?: string;
    /** Show remove button */
    removable?: boolean;
    /** Make chip clickable */
    clickable?: boolean;
    /** Callback when remove button is clicked */
    onRemove?: () => void;
    /** Callback when chip is clicked */
    onclick?: () => void;
  }

  let {
    type,
    label,
    icon: customIcon,
    tooltip,
    maxLabelWidth = '200px',
    removable = false,
    clickable = false,
    onRemove,
    onclick,
  }: Props = $props();

  // Get icon based on type, or use custom icon
  const displayIcon = $derived(customIcon ?? getIconForType(type));

  function getIconForType(type: Props['type']): IconDefinition {
    switch (type) {
      case 'diff':
        return faCodeBranch;
      case 'note':
        return faNote;
      case 'spec':
        return faClipboard;
      case 'selection':
        return faICursor;
      case 'folder':
      case 'workspace':
        return faFolder;
      case 'linear':
        return faTicket;
      case 'github':
        return faCodePullRequest;
      case 'sentry':
        return faBug;
      case 'external':
        return faLink;
      case 'file':
      default:
        return faFileLines;
    }
  }
</script>

{#if clickable}
  <button
    type="button"
    class="group/button flex items-center gap-1.5 px-2 py-0.5 bg-muted/70 text-muted-foreground rounded text-xs whitespace-nowrap cursor-pointer hover:bg-muted transition-colors shrink-0"
    title={tooltip ?? `Open ${label}`}
    {onclick}
  >
    <Fa icon={displayIcon} size="15" class="opacity-30" />
    <span class="font-medium truncate" style:max-width={maxLabelWidth}>{label}</span>
    {#if removable}
      <Button
        variant="ghost-light"
        size="icon-xs"
        class="opacity-0 group-hover/button:opacity-100 -my-1 -mr-2 -ml-2 transition-opacity"
        onclick={(e: MouseEvent) => {
          e.stopPropagation();
          onRemove?.();
        }}
        title="Remove"
        aria-label="Remove"
      >
        <Fa icon={faXmark} size="10" />
      </Button>
    {/if}
  </button>
{:else}
  <div
    class="group/button flex items-center gap-1.5 px-2 py-0.5 bg-muted/70 text-muted-foreground rounded text-xs whitespace-nowrap shrink-0"
    title={tooltip ?? label}
  >
    <Fa icon={displayIcon} size="15" class="opacity-30" />
    <span class="font-medium truncate" style:max-width={maxLabelWidth}>{label}</span>
    {#if removable}
      <Button
        variant="ghost-light"
        size="icon-xs"
        class="opacity-0 group-hover/button:opacity-100 -my-1 -mr-2 -ml-2 transition-opacity"
        onclick={() => onRemove?.()}
        title="Remove"
        aria-label="Remove"
      >
        <Fa icon={faXmark} size="10" />
      </Button>
    {/if}
  </div>
{/if}
