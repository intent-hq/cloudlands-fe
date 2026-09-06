<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronDown } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { DraftSource } from '$shared/types/workspace-draft';
  import { projectDescription, projectName } from './project-section';

  interface Props {
    source: DraftSource | null;
    onExpand?: () => void;
  }

  let { source, onExpand }: Props = $props();
</script>

<button
  type="button"
  class="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
  aria-expanded="false"
  aria-label={m.newWorkspace_setup_expand_ariaLabel()}
  onclick={onExpand}
>
  <span class="min-w-0 flex-1">
    <span class="type-caption block font-medium text-foreground">
      {source ? projectName(source) : m.newWorkspace_setup_noProject_label()}
    </span>
    <span class="type-caption block truncate text-muted-foreground">
      {source ? projectDescription(source) : m.newWorkspace_setup_noProject_description()}
    </span>
  </span>
  {#if source && (source.kind === 'local' || source.kind === 'github') && source.branch}
    <span class="type-caption shrink-0 text-muted-foreground">{source.branch}</span>
  {/if}
  <Fa icon={faChevronDown} class="size-3.5 shrink-0 text-muted-foreground" />
</button>
