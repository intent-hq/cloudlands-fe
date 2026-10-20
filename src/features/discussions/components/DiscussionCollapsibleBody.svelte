<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  let { children, footer }: { children: Snippet; footer?: Snippet } = $props();
  const contentId = $props.id();
  let expanded = $state(false);
  let overflowing = $state(false);
  let content: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (!content) return;
    const element = content;
    const measure = () => {
      overflowing = element.scrollHeight > 201;
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    return () => resize.disconnect();
  });
</script>

<div
  class={expanded ? 'overflow-hidden' : 'max-h-[200px] overflow-hidden'}
  data-discussion-collapsed={(overflowing && !expanded) || undefined}
>
  <div
    bind:this={content}
    id={contentId}
    onfocusin={() => {
      if (overflowing) expanded = true;
    }}
  >
    {@render children()}
  </div>
</div>
{@render footer?.()}
{#if overflowing}
  <Button
    variant="plain"
    size="compact"
    class="mt-2 h-auto self-start font-medium"
    aria-expanded={expanded}
    aria-controls={contentId}
    onclick={() => (expanded = !expanded)}
  >
    {expanded ? m.workspace_discussion_showLess_label() : m.workspace_discussion_showMore_label()}
  </Button>
{/if}
