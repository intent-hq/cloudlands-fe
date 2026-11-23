<script lang="ts">
  /**
   * Centered inline transcript divider: a rule on each side of a small muted
   * icon + label. Shared by informational rows (model, effort and provider
   * changes, goal notices) so they read as one visual family.
   */
  import type { Snippet } from 'svelte';
  import Fa from 'svelte-fa';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import { cn } from '$lib/utils/cn';

  interface Props {
    icon: IconDefinition;
    children: Snippet;
    /** Extra classes on the outer row (identifying class, margin override). */
    class?: string;
    role?: 'status' | null;
  }

  let { icon, children, class: className = '', role = 'status' }: Props = $props();
</script>

<div class={cn('my-4 flex w-full min-w-0 items-center gap-3', className)} role={role ?? undefined}>
  <div class="h-px min-w-4 flex-1 bg-border"></div>
  <span class="flex min-w-0 shrink items-start gap-2 text-left text-xs text-muted-foreground">
    <Fa {icon} class="mt-0.5 h-3 w-3 flex-shrink-0" />
    {@render children()}
  </span>
  <div class="h-px min-w-4 flex-1 bg-border"></div>
</div>
