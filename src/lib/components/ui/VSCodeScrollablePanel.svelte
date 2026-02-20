<script lang="ts">
  import VSCodePanel from './VSCodePanel.svelte';
  import { ScrollArea } from './scroll-area';
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    icon?: any; // FontAwesome icon
    defaultCollapsed?: boolean;
    collapsed?: boolean; // Allow external control
    storageKey?: string;
    collapsible?: boolean;
    class?: string;
    headerClass?: string;
    contentClass?: string;
    scrollAreaClass?: string;
    showAction?: boolean;
    actionIcon?: any;
    actionLabel?: string;
    actionDisabled?: boolean;
    loading?: boolean;
    onAction?: () => void;
    onCollapse?: () => void; // Callback for external collapse handling
    headerActions?: Snippet;
    beforeScroll?: Snippet; // Content rendered above the scroll area
    children?: Snippet;
  }

  let {
    title,
    icon = undefined,
    defaultCollapsed = false,
    collapsed: externalCollapsed = undefined,
    storageKey = undefined,
    collapsible = true,
    class: className = '',
    headerClass = '',
    contentClass = '',
    scrollAreaClass = '',
    showAction = false,
    actionIcon = undefined,
    actionLabel = '',
    actionDisabled = false,
    loading = false,
    onAction = undefined,
    onCollapse = undefined,
    headerActions = undefined,
    beforeScroll = undefined,
    children,
  }: Props = $props();
</script>

<VSCodePanel
  {title}
  {icon}
  {defaultCollapsed}
  collapsed={externalCollapsed}
  {storageKey}
  {collapsible}
  class={className}
  {headerClass}
  {showAction}
  {actionIcon}
  {actionLabel}
  {actionDisabled}
  {loading}
  {onAction}
  {onCollapse}
  {headerActions}
>
  <div class="relative flex-1 min-h-0 w-full overflow-hidden flex flex-col">
    {#if beforeScroll}
      <div class="shrink-0">
        {@render beforeScroll()}
      </div>
    {/if}
    <ScrollArea class="h-full w-full flex flex-col flex-1 min-h-0 {scrollAreaClass}">
      <div class="pb-1 flex flex-col flex-1 min-h-0 {contentClass}">
        {#if children}
          {@render children()}
        {/if}
      </div>
    </ScrollArea>
  </div>
</VSCodePanel>
