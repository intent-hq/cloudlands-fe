<script lang="ts">
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { selectChiefThreads } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';

  interface Props {
    workspace: unknown;
    agentId: string;
    agentName?: string;
    isActive?: boolean;
    autoFocus?: boolean;
  }

  let { agentId }: Props = $props();

  // Replicates ChatPanel's prop-mirroring init pattern
  // (`const agentIdStore = writable(agentId ?? '')` + mirroring effect).
  // svelte-ignore state_referenced_locally -- mirrors ChatPanel's init pattern.
  const agentIdStore = writable(agentId ?? '');
  $effect(() => {
    agentIdStore.set(agentId ?? '');
  });

  // Replicates ChatPanel re-reading its `agentId` prop while a Redux update
  // propagates: ChatPanel wires many selector readables at init and reads
  // `agentId` in reactive/callback code. Svelte compiles the prop into a lazy
  // getter that re-evaluates the parent expression, so this subscription fires
  // after ChiefCard's thread source empties but BEFORE the `{#if}` block tears
  // this component down — an unguarded `activeThread.agentId` throws here.
  const threads$ = selectChiefThreads();
  const unsubscribe = threads$.subscribe(() => {
    void agentId;
  });
  onDestroy(unsubscribe);
</script>

<div data-testid="mock-chat-panel">{$agentIdStore}</div>
