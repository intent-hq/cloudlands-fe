<script lang="ts" generics="T extends { key: string }">
  import type { Snippet } from 'svelte';
  import Fa from 'svelte-fa';
  import { faChevronRight, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { animatedHeight } from '$lib/motion';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  let {
    repos,
    expanded,
    ontoggle,
    row,
  }: {
    repos: readonly T[];
    expanded: boolean;
    ontoggle: () => void;
    row: Snippet<[T]>;
  } = $props();
</script>

<div class="mt-4" data-home-hidden-repositories>
  <div class="group/hidden relative flex items-center">
    <Button
      variant="ghost"
      class="h-9 w-full justify-start gap-2 pl-9 pr-2 text-muted-foreground"
      aria-expanded={expanded}
      onclick={ontoggle}
    >
      <span class="min-w-0 flex-1 truncate text-left font-medium"
        >{m.home_repository_hidden_label()}</span
      >
      {#if !expanded}<span class="shrink-0 text-xs font-normal tabular-nums"
          >{formatInteger(repos.length)}</span
        >{/if}
    </Button>
    <span
      class="pointer-events-none absolute left-1 flex size-7 items-center justify-center text-muted-foreground"
      aria-hidden="true"
    >
      <span
        class="flex size-5 items-center justify-center group-hover/hidden:opacity-0 group-focus-within/hidden:opacity-0"
      >
        <Fa icon={faEyeSlash} />
      </span>
      <span
        class="absolute flex items-center justify-center opacity-0 group-hover/hidden:opacity-100 group-focus-within/hidden:opacity-100"
      >
        <Fa icon={faChevronRight} class={expanded ? 'size-3! rotate-90' : 'size-3!'} size={12} />
      </span>
    </span>
  </div>
  <div use:animatedHeight={expanded} inert={!expanded} aria-hidden={!expanded}>
    <div class="pl-7">
      {#each repos as repo (repo.key)}
        {@render row(repo)}
      {/each}
    </div>
  </div>
</div>
