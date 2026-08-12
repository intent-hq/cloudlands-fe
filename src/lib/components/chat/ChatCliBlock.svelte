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

<div
  class="ws-block-widget group my-2 flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-foreground shadow-(--elevation-raised)"
>
  <Fa icon={faTerminal} size="sm" class="shrink-0 text-muted-foreground" />
  <code class="type-code min-w-0 flex-1 truncate bg-transparent p-0 text-foreground">
    {command}
  </code>
  <button
    type="button"
    class="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-50 transition-[background-color,color,opacity] hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 {copied
      ? 'opacity-100'
      : ''}"
    onclick={copyCommand}
    title={copied ? m.chat_cliBlock_copied_tooltip() : m.chat_cliBlock_copy_tooltip()}
    aria-label={m.chat_cliBlock_copy_ariaLabel()}
    data-testid="chat-cli-copy"
  >
    {#if copied}
      <Fa icon={faCheck} size="sm" class="text-success" />
    {:else}
      <Fa icon={faCopy} size="sm" />
    {/if}
  </button>
</div>
