<script lang="ts">
  import { onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTerminal, faCopy, faCheck } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { toast } from 'svelte-sonner';

  interface Props {
    command: string;
  }

  let { command }: Props = $props();

  let copied = $state(false);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      copied = true;
      if (copyTimeout) {
        clearTimeout(copyTimeout);
      }
      copyTimeout = setTimeout(() => {
        copied = false;
      }, 2000);
    } catch {
      toast.error(m.chat_cliBlock_copyFailed_error());
    }
  }

  onDestroy(() => {
    if (copyTimeout) {
      clearTimeout(copyTimeout);
    }
  });
</script>

<div class="my-1.5 flex items-center gap-2 group">
  <Fa icon={faTerminal} size="sm" class="text-ghost flex-none" />
  <code class="font-mono text-sm text-subtle flex-1 min-w-0 truncate">
    {command}
  </code>
  <button
    type="button"
    class="flex-none p-1 rounded cursor-pointer text-subtle hover:text-foreground transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100 {copied
      ? 'opacity-100'
      : ''}"
    onclick={copyCommand}
    title={copied ? m.chat_cliBlock_copied_tooltip() : m.chat_cliBlock_copy_tooltip()}
    aria-label={m.chat_cliBlock_copy_ariaLabel()}
    data-testid="chat-cli-copy"
  >
    {#if copied}
      <Fa icon={faCheck} size="sm" class="text-green-500" />
    {:else}
      <Fa icon={faCopy} size="sm" />
    {/if}
  </button>
</div>
