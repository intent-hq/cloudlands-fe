<script lang="ts">
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { faSearch } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { notify } from '$lib/components/patterns/notify';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectScriptDetectionOperation,
    selectScriptWorkflowOutcome,
  } from '$store/renderer/slices/scripts/scripts-selectors';
  import {
    detectScriptDefinitionsRequested,
    scriptWorkflowConsumed,
    scriptWorkflowReleased,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import type { ScriptDetectionOutcome } from '$store/renderer/slices/scripts/scripts-types';

  let { workspaceId, class: className }: { workspaceId: string; class?: string } = $props();

  const workspaceIdStore = writable('');
  const consumerId = crypto.randomUUID();
  const detectionOperation$ = selectScriptDetectionOperation(workspaceIdStore);
  const outcome$ = selectScriptWorkflowOutcome(consumerId, workspaceIdStore, 'local-detection');
  let pending = $state<{ requestId: string; workspaceId: string } | null>(null);
  let workflowWorkspaceId = '';
  const isDetecting = $derived(pending !== null || $detectionOperation$?.pending === true);

  $effect(() => {
    if (workflowWorkspaceId && workflowWorkspaceId !== workspaceId) {
      appStore.dispatch(scriptWorkflowReleased(workflowWorkspaceId, consumerId));
      pending = null;
    }
    workflowWorkspaceId = workspaceId;
    workspaceIdStore.set(workspaceId);
  });

  onDestroy(() => {
    if (workflowWorkspaceId) {
      appStore.dispatch(scriptWorkflowReleased(workflowWorkspaceId, consumerId));
    }
  });

  function detectScripts() {
    if (pending || selectScriptDetectionOperation.select(appStore.state, workspaceId)?.pending) {
      return;
    }
    if (!workspaceId) return;

    const requestId = crypto.randomUUID();
    pending = { requestId, workspaceId };
    appStore.dispatch(
      detectScriptDefinitionsRequested(workspaceId, {
        consumerId,
        requestId,
        resourceId: 'local-detection',
      }),
    );
  }

  $effect(() => {
    const outcome = $outcome$;
    if (
      !outcome ||
      !pending ||
      outcome.consumed ||
      outcome.status === 'pending' ||
      outcome.requestId !== pending.requestId ||
      outcome.workspaceId !== pending.workspaceId ||
      workspaceId !== pending.workspaceId
    ) {
      return;
    }

    pending = null;
    appStore.dispatch(scriptWorkflowConsumed(outcome.workspaceId, consumerId, outcome.requestId));
    if (outcome.status !== 'success' || !outcome.result) {
      notify.error(outcome.error ?? m.terminal_quakeOverlay_detectFailed_error());
      return;
    }
    const result = outcome.result as ScriptDetectionOutcome;
    notify[result.detected > 0 ? 'success' : 'info'](
      result.detected > 0
        ? result.detected === 1
          ? m.terminal_sidebar_detectedFromFiles_one({ count: result.detected })
          : m.terminal_sidebar_detectedFromFiles_many({ count: result.detected })
        : m.terminal_sidebar_noScriptsLocally_info(),
    );
  });
</script>

<Button
  variant="outline"
  size="sm"
  class={cn('type-caption', className)}
  disabled={isDetecting || !workspaceId}
  aria-busy={isDetecting}
  aria-label={m.terminal_quakeOverlay_detectScripts_label()}
  tooltip={m.terminal_sidebar_scanLocal_tooltip()}
  onclick={detectScripts}
>
  {#if isDetecting}
    <IntentMarkLoader size={12} />
    {m.terminal_sidebar_scanningFiles_label()}
  {:else}
    <Fa icon={faSearch} size="xs" />
    {m.terminal_quakeOverlay_detectScripts_label()}
  {/if}
</Button>
