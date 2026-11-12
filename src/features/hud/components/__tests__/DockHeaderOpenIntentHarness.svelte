<script lang="ts">
  /**
   * CT harness: the real dock conversation (wire fixtures) with main's
   * bring-Intent-forward request replaced at its IPC boundary by a counter.
   */
  import { onDestroy } from 'svelte';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import { WINDOW_CHANNELS } from '$shared/ipc/channels';
  import ConversationWireHarness from '../DockConversationWireHarness.svelte';

  let activations = $state(0);
  const restore = overrideMockIpcHandler(WINDOW_CHANNELS.ACTIVATE_APP, () => {
    activations += 1;
    return { activated: true };
  });
  onDestroy(restore);
</script>

<div data-testid="open-intent-harness" data-activations={activations}>
  <ConversationWireHarness width={360} height={560} />
</div>
