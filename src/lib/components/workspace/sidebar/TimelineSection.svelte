<script lang="ts">
  /**
   * TimelineSection - A section in a vertical timeline layout
   * Shows a colored dot node and title, with content in a slot
   */
  import Header from '$lib/components/ui/Header.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    subtitle?: string;
    active?: boolean;
    activeColor?: string;
    action?: Snippet;
    children?: Snippet;
  }

  let {
    title,
    active = false,
    subtitle,
    activeColor = 'bg-primary',
    action,
    children,
  }: Props = $props();
</script>

<div class="relative pl-5 pb-3">
  <!-- Timeline node -->
  <div
    class="absolute left-0 top-0.75 w-2.5 h-2.5 rounded-full border-[2px] border-sidebar {active
      ? activeColor
      : 'bg-border'}"
  ></div>

  <div class="flex items-center justify-between mb-1.5">
    <Header size={6}>
      {title}
      {#if subtitle}
        <span class="inline-block ml-0.5 opacity-60 font-normal">/ {subtitle}</span>
      {/if}
    </Header>
    {#if action}
      {@render action()}
    {/if}
  </div>

  {#if children}
    <div class="w-full pl-2">
      {@render children()}
    </div>
  {/if}
</div>
