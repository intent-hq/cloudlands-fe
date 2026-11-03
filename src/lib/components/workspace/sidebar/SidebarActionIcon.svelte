<script lang="ts" module>
  export type SidebarActionIconName =
    | 'plus'
    | 'search'
    | 'close'
    | 'refresh'
    | 'filter'
    | 'expand'
    | 'collapse'
    | 'open'
    | 'pull-request'
    | 'merge';
</script>

<script lang="ts">
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
  import FunnelIcon from 'phosphor-svelte/lib/FunnelIcon';
  import ArrowsOutSimpleIcon from 'phosphor-svelte/lib/ArrowsOutSimpleIcon';
  import ArrowsInSimpleIcon from 'phosphor-svelte/lib/ArrowsInSimpleIcon';
  import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
  import GitPullRequestIcon from 'phosphor-svelte/lib/GitPullRequestIcon';
  import GitMergeIcon from 'phosphor-svelte/lib/GitMergeIcon';
  import { cn } from '$lib/utils';

  let { icon, class: className }: { icon: SidebarActionIconName; class?: string } = $props();

  const icons = {
    plus: PlusIcon,
    search: MagnifyingGlassIcon,
    close: XIcon,
    refresh: ArrowClockwiseIcon,
    filter: FunnelIcon,
    expand: ArrowsOutSimpleIcon,
    collapse: ArrowsInSimpleIcon,
    open: ArrowSquareOutIcon,
    'pull-request': GitPullRequestIcon,
    merge: GitMergeIcon,
  };
  const Glyph = $derived(icons[icon]);
</script>

<Glyph
  size={16}
  weight="regular"
  mirrored={false}
  class={cn('size-4 shrink-0', className)}
  aria-hidden="true"
  focusable="false"
  data-owns-stroke
  data-sidebar-action-icon={icon}
/>
