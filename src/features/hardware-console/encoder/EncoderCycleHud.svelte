<script lang="ts">
  /**
   * Small HUD shown while the encoder rotation cycles the active workspace.
   * Purely presentational: the encoder service navigates and dispatches
   * `encoderHudShown`; the middleware hides it after rotation inactivity.
   * Sits at z-70 so it stays visible above modal overlays (z-60).
   */
  import { fade } from 'svelte/transition';
  import { m } from '$shared/paraglide/messages.js';
  import { getItem } from '$lib/store-shim/utils/collections/collection-utils';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import { selectEncoderHudWorkspaceId } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
  import { store as appStore } from '$store/renderer/store';

  const hudWorkspaceId$ = selectEncoderHudWorkspaceId();

  const title = $derived.by(() => {
    const workspaceId = $hudWorkspaceId$;
    if (workspaceId === null) return null;
    const workspace = getItem(appStore.state.workspace.workspaces, workspaceId as WorkspaceId);
    return workspace?.title?.trim() || m.hardwareConsole_encoderHud_untitled_label();
  });
</script>

{#if $hudWorkspaceId$ !== null && title !== null}
  <div
    class="fixed bottom-8 left-1/2 -translate-x-1/2 z-70 pointer-events-none"
    transition:fade={{ duration: 120 }}
    role="status"
    aria-label={m.hardwareConsole_encoderHud_ariaLabel()}
  >
    <div
      class="bg-background border border-border shadow-lg rounded-lg px-4 py-2 text-[13px] font-medium text-foreground max-w-96 truncate"
    >
      {title}
    </div>
  </div>
{/if}
