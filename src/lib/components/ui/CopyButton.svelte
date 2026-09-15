<script lang="ts">
  import { onDestroy } from 'svelte';
  import { crispOut, springIn } from '$lib/motion';
  import { logger } from '$lib/utils/client-logger';

  import { faCopy, faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    text?: string;
    size?: 'xs' | 'sm' | 'md';
    class?: string;
    disabled?: boolean;
    onCopy?: () => void;
    copy?: (event: MouseEvent) => void | Promise<void>;
    /** Optional keyboard shortcut to display in tooltip */
    shortcut?: string;
    /** Tooltip label, defaults to "Copy" */
    label?: string;
    /** Feedback label shown after a successful copy. */
    copiedLabel?: string;
    'data-testid'?: string;
  }

  let {
    text,
    size = 'xs',
    class: className = '',
    disabled = false,
    onCopy,
    copy,
    shortcut,
    label = m.ui_copyButton_label(),
    copiedLabel = m.ui_linkTooltip_copied_label(),
    'data-testid': testId,
  }: Props = $props();

  let copied = $state(false);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;
  const buttonSize = $derived(size === 'md' ? 'icon' : size === 'sm' ? 'icon-sm' : 'icon-xs');
  const feedbackLabel = $derived(copied ? copiedLabel : label);

  async function copyToClipboard(event: MouseEvent) {
    if (disabled) return;
    try {
      if (copy) await copy(event);
      else await navigator.clipboard.writeText(text ?? '');
      copied = true;
      onCopy?.();

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

<Button
  variant="ghost"
  size={buttonSize}
  iconOnly
  tooltip={feedbackLabel}
  tooltipShortcut={shortcut}
  tooltipDelayDuration={300}
  aria-label={feedbackLabel}
  title={feedbackLabel}
  {disabled}
  class={className}
  onclick={copyToClipboard}
  data-testid={testId}
>
  {#key copied}
    <span
      data-slot="copy-button-icon"
      class={copied
        ? 'flex items-center justify-center text-success'
        : 'flex items-center justify-center'}
      in:springIn={{ tier: 'fast', y: 0, scale: 0.7 }}
      out:crispOut={{ tier: 'fast' }}
    >
      {#if copied}
        <Fa icon={faCheck} {size} />
      {:else}
        <Fa icon={faCopy} {size} />
      {/if}
    </span>
  {/key}
</Button>
