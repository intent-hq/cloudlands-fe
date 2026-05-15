<script lang="ts">
  /**
   * ReleaseNotesModal - Displays release notes after an app update
   *
   * Shows what's new in the current version with user-friendly bullet points.
   */

  import { Button } from '$lib/components/ui/button';
  import {
  faCheck,
  faRocket,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import {
  fade,
  fly,
} from 'svelte/transition';

  interface ReleaseNotes {
    version: string;
    date: string;
    highlights: string[];
  }

  interface Props {
    open?: boolean;
    releaseNotes: ReleaseNotes | null;
    onClose?: () => void;
  }

  let { open = $bindable(false), releaseNotes, onClose }: Props = $props();

  function close() {
    open = false;
    onClose?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    }
  }
</script>

{#if open && releaseNotes}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    onkeydown={handleKeydown}
    onclick={close}
    in:fade={{ duration: 150 }}
  >
    <div
      class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
      in:fly={{ y: 20, duration: 200 }}
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Fa icon={faRocket} class="text-primary" />
          </div>
          <div>
            <h2 class="text-lg font-semibold">What's New</h2>
            <p class="text-sm text-subtle">Version {releaseNotes.version}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onclick={close}>
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Content -->
      <div class="px-6 py-4">
        {#if releaseNotes.highlights && releaseNotes.highlights.length > 0}
          <ul class="space-y-3">
            {#each releaseNotes.highlights as highlight}
              <li class="flex items-start gap-3">
                <div
                  class="mt-0.5 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"
                >
                  <Fa icon={faCheck} class="w-2.5 h-2.5 text-primary" />
                </div>
                <span class="text-sm text-foreground leading-relaxed">{highlight}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-subtle">Bug fixes and performance improvements.</p>
        {/if}
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-border flex justify-end">
        <Button onclick={close}>Got it</Button>
      </div>
    </div>
  </div>
{/if}
