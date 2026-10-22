<script lang="ts">
  /**
   * TimelineSection - A section in a vertical timeline layout
   * Shows a colored dot node and title, with content in a slot
   */
  import { Button } from '$lib/components/ui/button';
  import { faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Header from '$lib/components/ui/Header.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    subtitle?: string;
    collapsible?: boolean;
    expanded?: boolean;
    onToggle?: () => void;
    active?: boolean;
    activeColor?: string;
    action?: Snippet;
    children?: Snippet;
  }

  let {
    title,
    collapsible = false,
    expanded = true,
    onToggle,
    subtitle,
    action,
    children,
  }: Props = $props();
</script>

<div class="relative min-w-0 pb-1">
  <div class="flex h-8 min-w-0 items-center justify-between gap-2 px-2">
    <Header size={5} class="type-caption min-w-0 truncate font-normal text-muted-foreground">
      {#if collapsible}
        <Button
          variant="plain"
          size="compact"
          class="h-8 min-w-0 justify-start gap-1 rounded-md px-2 -mx-2 type-caption font-normal hover:bg-muted"
          aria-expanded={expanded}
          onclick={onToggle}
          onkeydown={(event) => event.stopPropagation()}
        >
          {title}
          {#if subtitle}
            <span class="inline-block ml-0.5 font-normal text-muted-foreground">/ {subtitle}</span>
          {/if}
          {#snippet trailingIcon()}
            <Fa
              icon={expanded ? faChevronDown : faChevronRight}
              class="size-2.5 text-muted-foreground"
            />
          {/snippet}
        </Button>
      {:else}
        {title}
        {#if subtitle}
          <span class="inline-block ml-0.5 font-normal text-muted-foreground">/ {subtitle}</span>
        {/if}
      {/if}
    </Header>
    {#if action}
      {@render action()}
    {/if}
  </div>

  {#if children && (!collapsible || expanded)}
    <div class="w-full min-w-0">
      {@render children()}
    </div>
  {/if}
</div>
