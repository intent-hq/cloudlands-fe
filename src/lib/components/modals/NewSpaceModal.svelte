<script lang="ts">
  /**
   * NewSpaceModal - Modal wrapper around CompactWorkspaceInitializer
   * Can be opened from anywhere in the app (Cmd+N, sidebar, overlay, etc.)
   * without navigating away from the current page.
   */
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import Button from '$lib/components/ui/button/button.svelte';
  import CompactWorkspaceInitializer, {
    type InitialRepoInfo,
  } from '$lib/components/workspace/CompactWorkspaceInitializer.svelte';

  interface Props {
    open?: boolean;
    initialRepo?: InitialRepoInfo;
    onClose?: () => void;
  }

  let { open = $bindable(false), initialRepo, onClose }: Props = $props();

  let isExpanded = $state(true);
  let initializerRef: CompactWorkspaceInitializer | null = $state(null);

  function close() {
    open = false;
    onClose?.();
  }

  // Global keydown listener so Escape works even when inputs are focused
  $effect(() => {
    if (!open) return;

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }

    window.addEventListener('keydown', handleKeydown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeydown, { capture: true });
  });

  // Focus the form when the modal opens
  $effect(() => {
    if (open) {
      isExpanded = true;
      // Wait for the CompactWorkspaceInitializer and its RichTextarea to fully mount
      setTimeout(() => {
        initializerRef?.focusAndSelectAll();
      }, 150);
    }
  });
</script>

{#if open}
    <div class="absolute inset-0 bg-background/50 backdrop-blur cursor-pointer z-50"
    onclick={close} transition:fade={{ duration: 150 }} />
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-60 flex items-start justify-center overflow-y-auto pointer-events-none"
    role="presentation"
    aria-hidden="true"
    transition:fly={{ y: 20, duration: 200 }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="relative w-full max-w-4xl flex flex-col py-[12vh] px-4 z-20 pointer-events-auto"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      transition:fly={{ y: -8, duration: 180 }}
    >
      <!-- Header -->
      <div class="px-1 pb-4 flex items-center justify-between shrink-0">
        <h2 class="text-lg font-medium tracking-[-0.02em] text-foreground/90">New Space</h2>
        <Button
          variant="ghost-light"
          size="icon-xs"
          class="text-muted-foreground/50 hover:text-foreground"
          onclick={close}
        >
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Form -->
      <div class="bg-sidebar border border-border shadow-xs px-12 py-8">
        <CompactWorkspaceInitializer
          bind:this={initializerRef}
          bind:isExpanded
          {initialRepo}
          oncreate={close}
        />
      </div>
    </div>
  </div>
{/if}
