<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';

  let {
    count,
    attention,
    running,
    workspaces,
  }: {
    count: number;
    attention: boolean;
    running: boolean;
    workspaces: DockWorkspaceView[];
  } = $props();
  const states = $derived(workspaces.map((item) => resolveWorkspaceStatusState(item.workspace)));
  const status = $derived(
    states.includes('failed')
      ? 'failed'
      : states.includes('blocked')
        ? 'blocked'
        : attention || states.includes('needs_attention')
          ? 'needs_attention'
          : running
            ? 'in_progress'
            : count > 0
              ? 'unread'
              : states.includes('waiting')
                ? 'waiting'
                : 'idle',
  );
  const label = $derived(
    `${m.dock_updatesCount_label({ count })}: ${getWorkspaceStatusPresentation(status).accessibleName}`,
  );
</script>

<span
  class="notch-updates"
  role="status"
  aria-label={label}
  title={label}
  data-testid="dock-update-count"
  data-count={count}
>
  <span class="notch-status-dot" aria-hidden="true"
    ><WorkspaceStatusIcon {status} size={12} decorative /></span
  >
  <span class="notch-update-number font-mono tabular-nums" aria-hidden="true">{count}</span>
</span>

<style>
  .notch-updates {
    display: flex;
    align-items: center;
    gap: 6px;
    color: hsl(var(--muted-foreground));
    white-space: nowrap;
  }
  .notch-update-number {
    font-size: 12px;
  }
  .notch-status-dot {
    position: relative;
    width: 6px;
    height: 6px;
    flex: none;
  }
  .notch-status-dot :global(.workspace-status-icon) {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  .notch-status-dot :global(.workspace-status-dot) {
    width: 6px;
    height: 6px;
  }
</style>
