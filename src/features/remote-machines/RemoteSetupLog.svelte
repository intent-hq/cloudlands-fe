<!--
  Read-only checkout and setup output of a remote agent (PROTOCOL
  `methods/nodes.md` "Prepared checkout", `setup.output`). Detail reads carry
  the last 256 KiB; the view follows new output while scrolled to the end.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { scriptOutputToLines } from '$lib/utils/script-output-text';

  interface Props {
    machine: string;
    output?: string;
    truncated?: boolean;
  }

  let { machine, output, truncated = false }: Props = $props();

  const text = $derived(
    scriptOutputToLines({ chunks: [{ text: output ?? '', timestamp: '' }], dropped: 0 }).join('\n'),
  );

  let log = $state<HTMLPreElement | null>(null);
  let following = true;

  function onscroll() {
    if (!log) return;
    following = log.scrollHeight - log.scrollTop - log.clientHeight < 8;
  }

  $effect(() => {
    void text;
    if (!log || !following) return;
    void tick().then(() => {
      if (log) log.scrollTop = log.scrollHeight;
    });
  });
</script>

<div class="space-y-1" data-remote-setup-log>
  {#if truncated}
    <p class="type-caption text-subtle">{m.remoteAgent_setup_outputTruncated()}</p>
  {/if}
  <!-- A scrollable region needs focus so the keyboard can scroll it. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <pre
    bind:this={log}
    {onscroll}
    role="log"
    aria-label={m.remoteAgent_setup_outputLabel({ machine })}
    tabindex="0"
    class="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 px-3 py-2 font-mono text-xs {text
      ? 'text-foreground'
      : 'text-subtle'} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">{text ||
      m.remoteAgent_setup_noOutput()}</pre>
</div>
