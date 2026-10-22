<script lang="ts">
  import { tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import type { ChiefThreadSummary } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import type { AssistantThreadRename } from './assistant-thread-rename.svelte';

  let {
    thread,
    rename,
    class: className,
  }: {
    thread: ChiefThreadSummary;
    rename: AssistantThreadRename;
    class?: string;
  } = $props();
  let titleRef = $state<HTMLButtonElement | HTMLAnchorElement | null>(null);

  async function handleBlur(event: FocusEvent) {
    const element = event.currentTarget as HTMLInputElement;
    if (!event.relatedTarget) {
      await tick();
      if (!element.isConnected || document.activeElement === element) return;
    }
    rename.save('blur');
  }
</script>

{#if rename.agentId === thread.agentId}
  <Input
    bind:ref={rename.input}
    bind:value={rename.name}
    size="compact"
    aria-label={m.layout_chiefCard_threadName_label()}
    aria-invalid={Boolean(rename.error)}
    aria-busy={rename.busy}
    title={rename.error}
    disabled={rename.busy}
    onkeydown={rename.keydown}
    onblur={handleBlur}
    class={cn('h-6! min-w-0 px-1 py-0', className, rename.error && 'border-danger')}
  />
{:else}
  <Button
    bind:ref={titleRef}
    variant="plain"
    size="compact"
    disabled={rename.busy}
    aria-label={m.layout_chiefCard_renameThread_ariaLabel({ title: thread.title })}
    title={m.layout_chiefCard_renameThread_title()}
    onclick={() =>
      rename.start(thread, () => {
        if (titleRef?.isConnected) titleRef.focus();
      })}
    class={cn(
      'h-auto! min-w-0 max-w-full cursor-text justify-start rounded-sm px-0 py-0 text-left',
      className,
    )}
  >
    {thread.title}
  </Button>
{/if}
