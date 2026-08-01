<script lang="ts">
  /**
   * SYSTEM panel — intentd online row (pulsing dot), live-ticking uptime,
   * total agents, and workspace count. Uptime extrapolates from the last
   * `system.status` snapshot (`uptimeSeconds` + elapsed since fetch) so it
   * ticks without re-polling; it freezes while the daemon is offline.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { selectHudSystem } from '$store/renderer/slices/hud/hud-selectors';
  import { formatHudTimer } from '../utils/hud-format';

  let {
    agentTotal,
    workspaceTotal,
    nowMs,
  }: { agentTotal: number; workspaceTotal: number; nowMs: number } = $props();

  const system$ = selectHudSystem();

  const online = $derived($system$.online);
  const uptimeText = $derived.by(() => {
    const { uptimeSeconds, fetchedAtMs, online: isOnline } = $system$;
    if (uptimeSeconds === null || fetchedAtMs === null) return formatHudTimer(0);
    const elapsed = isOnline ? Math.max(0, (nowMs - fetchedAtMs) / 1000) : 0;
    return formatHudTimer(uptimeSeconds + elapsed);
  });
</script>

<div class="hud-system-body">
  <div class="hud-system-row">
    <span class="hud-system-dot" class:hud-system-dot-online={online}></span>
    <!-- i18n-ignore (brand/daemon name) -->
    <span class="hud-system-key">INTENTD</span>
    <span class="hud-system-spacer"></span>
    {#if online}
      <span class="hud-system-online">{m.hud_system_online_label()}</span>
    {:else}
      <span class="hud-system-offline">{m.hud_system_offline_label()}</span>
    {/if}
  </div>
  <div class="hud-system-row">
    <span class="hud-system-key">{m.hud_system_uptime_label()}</span>
    <span class="hud-system-spacer"></span>
    <span>{uptimeText}</span>
  </div>
  <div class="hud-system-row">
    <span class="hud-system-key">{m.hud_system_agents_label()}</span>
    <span class="hud-system-spacer"></span>
    <span>{agentTotal}</span>
  </div>
  <div class="hud-system-row">
    <span class="hud-system-key">{m.hud_system_workspaces_label()}</span>
    <span class="hud-system-spacer"></span>
    <span>{workspaceTotal}</span>
  </div>
</div>

<style>
  .hud-system-body {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 12px;
    font:
      500 11px 'JetBrains Mono',
      monospace;
  }
  .hud-system-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hud-system-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: hsl(var(--destructive-foreground));
  }
  .hud-system-dot-online {
    background: hsl(var(--primary));
    animation: hudpulse 2.2s ease-in-out infinite;
  }
  .hud-system-key {
    color: hsl(var(--text-subtle));
  }
  .hud-system-spacer {
    flex: 1;
  }
  .hud-system-online {
    color: hsl(var(--primary));
  }
  .hud-system-offline {
    color: hsl(var(--destructive-foreground));
    animation: hudblink 1.6s step-end infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .hud-system-dot-online,
    .hud-system-offline {
      animation: none;
    }
  }
</style>
