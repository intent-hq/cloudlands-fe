<script lang="ts">
  /**
   * HUD left column — SYSTEM, AGENTS BY STATE, and WORKSPACES BY STATE
   * panels (mock's 296px rail). State bars read the hud slice selectors;
   * the bottom slot is reserved for the ATTENTION panel task.
   */
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectHudAgentStateCounts,
    selectHudAttnCount,
    selectHudWorkspaceStateBars,
  } from '$store/renderer/slices/hud/hud-selectors';
  import HudPanel from './HudPanel.svelte';
  import HudStateBars from './HudStateBars.svelte';
  import HudSystemPanel from './HudSystemPanel.svelte';
  import AttentionPanel from '../right-column/AttentionPanel.svelte';
  import { HUD_STATE_COLORS } from '../grid/hud-card-meta';

  let { nowMs }: { nowMs: number } = $props();

  const agentCounts$ = selectHudAgentStateCounts();
  const workspaceBars$ = selectHudWorkspaceStateBars();
  // Blink the WORKSPACE-STATS attention row yellow while any workspace needs
  // input — gated on the SAME card-derived count the header ATTN counter uses
  // (top-level, non-background; no blink at zero).
  const attnCount$ = selectHudAttnCount();

  const agentTotal = $derived(
    $agentCounts$.running +
      $agentCounts$['needs-attention'] +
      $agentCounts$.done +
      $agentCounts$.failed +
      $agentCounts$.idle,
  );

  // AGENTS BY STATE shows only the live-agent buckets — RUNNING, FAILED, IDLE;
  // the NEEDS ATTENTION and DONE rows moved to the workspace-level rollups.
  // Colors come from the canonical HUD_STATE_COLORS table (hud-card-meta).
  const agentBars = $derived([
    {
      label: m.hud_agentState_running_label(),
      count: $agentCounts$.running,
      color: HUD_STATE_COLORS.running,
    },
    {
      label: m.hud_agentState_failed_label(),
      count: $agentCounts$.failed,
      color: HUD_STATE_COLORS.failed,
    },
    {
      label: m.hud_agentState_idle_label(),
      count: $agentCounts$.idle,
      color: HUD_STATE_COLORS.idle,
    },
  ]);

  // WORKSPACE STATS — the SAME buckets the header counters use (IDLE,
  // PROGRESS, ATTENTION, PR OPEN, PR MERGED, FAILED, COMPLETED) so header,
  // left bars, and grid all agree — canonical HUD_STATE_COLORS tokens.
  const workspaceBars = $derived([
    {
      label: m.hud_workspaceState_idle_label(),
      count: $workspaceBars$.idle,
      color: HUD_STATE_COLORS.idle,
    },
    {
      label: m.hud_workspaceState_unread_label(),
      count: $workspaceBars$.unread,
      color: HUD_STATE_COLORS.unread,
      testId: 'hud-workspace-bar-unread',
    },
    {
      label: m.hud_workspaceState_progress_label(),
      count: $workspaceBars$.progress,
      color: HUD_STATE_COLORS.running,
    },
    {
      label: m.hud_workspaceState_attention_label(),
      count: $workspaceBars$.attention,
      color: HUD_STATE_COLORS.attention,
      blink: $attnCount$ > 0,
      testId: 'hud-workspace-bar-attention',
    },
    {
      label: m.hud_workspaceState_prOpen_label(),
      count: $workspaceBars$.prOpen,
      color: HUD_STATE_COLORS.pr,
    },
    {
      label: m.hud_workspaceState_prMerged_label(),
      count: $workspaceBars$.prMerged,
      color: HUD_STATE_COLORS.prMerged,
    },
    {
      label: m.hud_workspaceState_failed_label(),
      count: $workspaceBars$.failed,
      color: HUD_STATE_COLORS.failed,
    },
    {
      label: m.hud_workspaceState_completed_label(),
      count: $workspaceBars$.completed,
      color: HUD_STATE_COLORS.done,
    },
  ]);
</script>

<div class="hud-left-column" data-testid="hud-left-column">
  <HudPanel title={m.hud_system_title()}>
    {#snippet meta()}
      <span class="hud-system-meta">
        {$workspaceBars$.attention > 0 ||
        $workspaceBars$.failed > 0 ||
        $agentCounts$.failed > 0
          ? m.hud_system_fail_label()
          : m.hud_system_pass_label()}
      </span>
    {/snippet}
    <HudSystemPanel {agentTotal} workspaceTotal={$workspaceBars$.total} {nowMs} />
  </HudPanel>

  <HudPanel title={m.hud_agents_title()}>
    <HudStateBars bars={agentBars} total={Math.max(agentTotal, 1)} />
  </HudPanel>

  <HudPanel title={m.hud_workspaces_title()}>
    <HudStateBars bars={workspaceBars} total={Math.max($workspaceBars$.total, 1)} />
  </HudPanel>

  <!-- ATTENTION panel (renders nothing while no items are raised) -->
  <div class="hud-attention-slot" data-testid="hud-attention-slot">
    <AttentionPanel />
  </div>
</div>

<style>
  .hud-left-column {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
  }
  .hud-system-meta {
    font:
      500 9px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
  }
  .hud-attention-slot {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
