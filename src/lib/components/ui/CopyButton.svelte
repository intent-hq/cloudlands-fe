<script lang="ts">
  import { onDestroy } from 'svelte';
  import { logger } from '$lib/utils/client-logger';

  import {
  faCopy,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { TooltipShortcut } from './tooltip';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    text: string;
    size?: 'xs' | 'sm' | 'md';
    class?: string;
    /** Optional keyboard shortcut to display in tooltip */
    shortcut?: string;
    /** Tooltip label, defaults to "Copy" */
    label?: string;
  }

  let { text, size = 'xs', class: className = '', shortcut, label = m.ui_copyButton_label() }: Props = $props();

  let copied = $state(false);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;

      // Clear any existing timeout
      if (copyTimeout) {
        clearTimeout(copyTimeout);
      }

      // Reset after 2 seconds
      copyTimeout = setTimeout(() => {
        copied = false;
      }, 2000);
    } catch (err) {
      logger.error('Failed to copy:', err);
    }
  }

  onDestroy(() => {
    if (copyTimeout) {
      clearTimeout(copyTimeout);
    }
  });
</script>

<TooltipShortcut {label} {shortcut} side="top" delayDuration={300}>
  <button
    class="p-2 rounded cursor-pointer transition-colors {className}"
    onclick={copyToClipboard}
    type="button"
  >
    {#if copied}
      <Fa icon={faCheck} {size} class="text-green-500" />
    {:else}
      <Fa icon={faCopy} {size} />
    {/if}
  </button>
</TooltipShortcut>
