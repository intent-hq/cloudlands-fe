<!--
  Output of one remote agent's run of a saved script (`remoteScripts: 1`).
  Machine runs publish no `script:output` events, so the viewer reads
  `script.output { remoteAgentId }` when the run changes and, while it is
  live, again every few seconds (one read in flight at a time). Shown as
  plain text; the backend run keeps its streaming xterm viewer.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { m } from '$shared/paraglide/messages.js';
  import { scriptOutputToLines } from '$lib/utils/script-output-text';
  import { selectScriptRetainedOutput } from '$store/renderer/slices/scripts/scripts-selectors';
  import {
    scriptOutputReleased,
    scriptOutputRequested,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import { store as appStore } from '$store/renderer/store';
  import type { ScriptMachineRun } from '../types';
  import { isLiveScriptStatus } from '../utils/script-status';

  interface Props {
    workspaceId: string;
    scriptId: string;
    run: ScriptMachineRun;
    class?: string;
  }

  /** Re-read cadence while the run is live. */
  const POLL_MS = 2_000;

  let { workspaceId, scriptId, run, class: className = '' }: Props = $props();

  const uid = $props.id();
  const viewerId = `machine-run-${uid}`;
  const workspaceIdStore = writable(untrack(() => workspaceId));
  const scriptIdStore = writable(untrack(() => scriptId));
  $effect(() => {
    workspaceIdStore.set(workspaceId);
    scriptIdStore.set(scriptId);
  });
  const retained$ = selectScriptRetainedOutput(workspaceIdStore, scriptIdStore, viewerId);

  // The last text read, kept while a re-read is loading so the view doesn't blank.
  let shown = $state<string | null>(null);
  $effect(() => {
    const output = $retained$;
    if (output?.status === 'available' && output.text !== undefined) {
      shown = scriptOutputToLines({
        chunks: [{ text: output.text, timestamp: '' }],
        dropped: 0,
      }).join('\n');
    } else if (output?.status === 'unavailable') shown = '';
  });

  function read() {
    if ($retained$?.status === 'loading') return;
    appStore.dispatch(scriptOutputRequested(workspaceId, scriptId, viewerId, run.remoteAgentId));
  }

  // A new run state (start, exit, restart, lost) re-reads at once.
  const runKey = $derived(JSON.stringify(run.runtime));
  $effect(() => {
    void runKey;
    untrack(read);
  });

  $effect(() => {
    if (!isLiveScriptStatus(run.runtime.status)) return;
    const timer = setInterval(() => untrack(read), POLL_MS);
    return () => clearInterval(timer);
  });

  onDestroy(() => {
    appStore.dispatch(scriptOutputReleased(workspaceId, scriptId, viewerId));
  });
</script>

<div
  class="min-h-0 overflow-auto bg-background px-3 py-2 {className}"
  data-machine-run-output={run.remoteAgentId}
>
  {#if shown}
    <pre class="whitespace-pre-wrap break-words font-mono text-xs text-foreground">{shown}</pre>
  {:else if shown === ''}
    <p class="type-caption text-muted-foreground">{m.scripts_remote_noOutput_label()}</p>
  {/if}
</div>
