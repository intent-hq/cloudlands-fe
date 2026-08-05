<script lang="ts">
  import {
  faTerminal,
  faCopy,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '$lib/components/ui/button/button.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    name: string;
    description: string;
    content: string;
    onUseScript?: (script: { name: string; description: string; content: string }) => void;
  }

  let { name, description, content, onUseScript }: Props = $props();
  let copied = $state(false);

  function handleCopy() {
    navigator.clipboard.writeText(content);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  function handleUse() {
    onUseScript?.({ name, description, content });
  }
</script>

<div class="flex flex-col gap-2 px-4 py-3 bg-muted/30 border border-border rounded-lg my-4">
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <div class="shrink-0 text-subtle">
        <Fa icon={faTerminal} size="sm" />
      </div>
      <div class="font-medium text-sm">{name}</div>
    </div>
    <div class="flex items-center gap-1">
      <Button variant="ghost-light" size="sm" onclick={handleCopy} class="h-7 px-2">
        <Fa icon={copied ? faCheck : faCopy} class="mr-1" />
        {copied ? m.chat_shared_copied_label() : m.chat_shared_copy_label()}
      </Button>
      {#if onUseScript}
        <Button variant="ghost-light" size="sm" onclick={handleUse} class="h-7 px-2">
          {m.chat_setupScriptCard_useScript_label()}
        </Button>
      {/if}
    </div>
  </div>
  <div class="text-xs text-subtle">{description}</div>
  <pre
    class="text-xs bg-background/50 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto font-mono">{content}</pre>
</div>
