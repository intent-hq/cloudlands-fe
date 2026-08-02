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

  let { nowMs }: { nowMs: number } = $props();

  const agentCounts$ = selectHudAgentStateCounts();
  const workspaceBars$ = selectHudWorkspaceStateBars();
  // Blink the WORKSPACES-BY-STATE attention row yellow while any workspace
  // needs input — gated on the SAME card-derived count the header ATTN
  // counter uses (top-level, non-background; no blink at zero).
  const attnCount$ = selectHudAttnCount();

  const agentTotal = $derived(
    $agentCounts$.running +
      $agentCounts$['needs-attention'] +
      $agentCounts$.done +
      $agentCounts$.failed +
      $agentCounts$.idle,
  );

  // Mock palette: RUNNING primary, NEEDS ATTENTION warning (blinking while
  // non-zero, like the workspace attention bar), DONE ring, FAILED
  // destructive, IDLE ghost.
  const agentBars = $derived([
    {
      label: m.hud_agentState_running_label(),
      count: $agentCounts$.running,
      color: 'hsl(var(--primary))',
    },
    {
      label: m.hud_agentState_needsAttention_label(),
      count: $agentCounts$['needs-attention'],
      color: 'hsl(var(--warning))',
      blink: $agentCounts$['needs-attention'] > 0,
      testId: 'hud-agent-bar-needs-attention',
    },
    { label: m.hud_agentState_done_label(), count: $agentCounts$.done, color: 'hsl(var(--ring))' },
    {
      label: m.hud_agentState_failed_label(),
      count: $agentCounts$.failed,
      color: 'hsl(var(--destructive-foreground))',
    },
    {
      label: m.hud_agentState_idle_label(),
      count: $agentCounts$.idle,
      color: 'hsl(var(--text-ghost))',
    },
  ]);

  const workspaceBars = $derived([
    {
      label: m.hud_workspaceState_progress_label(),
      count: $workspaceBars$.progress,
      color: 'hsl(var(--primary))',
    },
    {
      label: m.hud_workspaceState_prOpen_label(),
      count: $workspaceBars$.prOpen,
      color: 'hsl(var(--ring))',
    },
    {
      label: m.hud_workspaceState_prMerged_label(),
      count: $workspaceBars$.prMerged,
      color: 'hsl(262 60% 62%)',
    },
    {
      label: m.hud_workspaceState_attention_label(),
      count: $workspaceBars$.attention,
      color: 'hsl(var(--warning))',
      blink: $attnCount$ > 0,
      testId: 'hud-workspace-bar-attention',
    },
    {
      label: m.hud_workspaceState_idle_label(),
      count: $workspaceBars$.idle,
      color: 'hsl(var(--text-ghost))',
    },
  ]);
</script>

<div class="hud-left-column" data-testid="hud-left-column">
  <HudPanel title={m.hud_system_title()}>
    {#snippet meta()}
      <span class="hud-system-meta">
        {$workspaceBars$.attention > 0 || agentBars[3].count > 0
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
