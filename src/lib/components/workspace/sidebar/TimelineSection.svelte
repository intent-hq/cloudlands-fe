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
    active = false,
    subtitle,
    activeColor = 'bg-primary',
    action,
    children,
  }: Props = $props();
</script>

<div class="relative pl-4 pb-2">
  <!-- Timeline node -->
  <div
    class="absolute left-[3px] top-[9px] size-1.5 rounded-full bg-border {active
      ? activeColor
      : 'bg-border'}"
  ></div>

  <div class="flex items-center justify-between mb-1">
    <Header size={5} class="shrink-0 whitespace-nowrap">
      {#if collapsible}
        <Button
          variant="plain"
          size="compact"
          class="h-auto justify-start gap-1 text-[length:inherit] font-medium"
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
    <div class="w-full pl-2">
      {@render children()}
    </div>
  {/if}
</div>
