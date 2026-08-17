<script lang="ts">
  import Fa from 'svelte-fa';
  import { cn } from '$lib/utils';
  import {
    getWorkspaceStatusPresentation,
    type WorkspaceStatusPresentationState,
  } from './utils/workspace-status-presentation';

  let {
    status,
    size = 14,
    decorative = false,
    class: className,
  }: {
    status: WorkspaceStatusPresentationState;
    size?: number;
    decorative?: boolean;
    class?: string;
  } = $props();

  const presentation = $derived(getWorkspaceStatusPresentation(status));
</script>

<span
  class={cn(
    'workspace-status-icon inline-flex shrink-0 items-center justify-center forced-colors:text-[CanvasText]',
    presentation.className,
    className,
  )}
  style="width: {size}px; height: {size}px;"
  role={decorative ? undefined : 'img'}
  aria-label={decorative ? undefined : presentation.accessibleName}
  aria-hidden={decorative ? 'true' : undefined}
  title={decorative ? undefined : presentation.tooltip}
  data-workspace-status={presentation.state}
  data-workspace-status-icon={presentation.icon.iconName}
>
  <Fa icon={presentation.icon} class="size-full!" />
</span>
