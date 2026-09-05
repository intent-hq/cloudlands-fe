<script lang="ts">
  import Fa from 'svelte-fa';
  import { faTerminal } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { notify } from '$lib/components/patterns/notify';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';

  interface Props {
    command: string;
  }

  let { command }: Props = $props();

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
    } catch (error) {
      notify.error(m.chat_cliBlock_copyFailed_error());
      throw error;
    }
  }
</script>

<div
  class="ws-block-widget group my-2 flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-foreground shadow-(--elevation-raised)"
>
  <Fa icon={faTerminal} size="sm" class="shrink-0 text-muted-foreground" />
  <code class="type-code min-w-0 flex-1 truncate bg-transparent p-0 text-foreground">
    {command}
  </code>
  <CopyButton
    copy={copyCommand}
    label={m.chat_cliBlock_copy_tooltip()}
    copiedLabel={m.chat_cliBlock_copied_tooltip()}
    class="size-7 shrink-0 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
    data-testid="chat-cli-copy"
  />
</div>
