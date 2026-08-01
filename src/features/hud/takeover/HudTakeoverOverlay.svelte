<script lang="ts">
  /**
   * HUD takeover overlay (mock lines 239-358) — the full-screen event
   * spotlight: wipe-in choreography (backdrop → fill → edges → corners →
   * rulers → content), typewriter banner (`bannerin`), infinite task-map
   * canvas (192px pitch, spec cell at 0,0, changed cell ring-blink +
   * pan-to-cell when far), WHAT CHANGED list, ACTIVE/IDLE agent rosters,
   * RETURN countdown and DISMISS. Sequenced by the pure takeover queue:
   * bursts enqueue, duplicates coalesce, DISMISS skips to the next entry.
   * A manual card-click opens a VIEWER entry (queue `isViewer`): the same
   * map/agents/changes content WITHOUT the event banners or the RETURN
   * countdown — it stays open until DISMISS. Under reduced motion every
   * animation is skipped (content renders immediately) but timing/queue
   * behavior is unchanged.
   */
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { hudTakeoverRequestCleared } from '$store/renderer/slices/hud/hud-slice';
  import {
    selectHudTakeoverRequestWorkspaceId,
    selectHudTakeoverView,
    type HudCardAgent,
  } from '$store/renderer/slices/hud/hud-selectors';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
  import { hydrateTaskAgentAssociationsRequested } from '$store/renderer/slices/task-agent-associations/task-agent-associations-slice';
  import { formatHudTimer } from '../utils/hud-format';
  import { watchReducedMotion } from '../right-column/hud-slide.svelte';
  import { onTakeoverTrigger } from './hud-takeover-bus';
  import {
    activeTakeoverTrigger,
    createHudTakeoverQueue,
    dismissTakeover,
    enqueueTakeover,
    nextTakeoverDeadline,
    requestImmediateTakeover,
    takeoverCountdownSeconds,
    tickTakeoverQueue,
    type HudTakeoverQueueState,
    type HudTakeoverTrigger,
  } from './hud-takeover-queue';
  import {
    canvasBounds,
    cellNeedsPan,
    HUD_TAKEOVER_CELL_PX,
    HUD_TAKEOVER_PITCH_PX,
    spiralCoords,
  } from './hud-takeover-layout';
  import {
    agentBucketLabel,
    takeoverKindColor,
    takeoverKindLabel,
    taskCellMeta,
  } from './hud-takeover-meta';
  import { agentBucketColor } from '../grid/hud-card-meta';

  let { nowMs }: { nowMs: number } = $props();

  // ── Queue (component-local; the pure utility owns all transitions) ──
  let queue = $state<HudTakeoverQueueState>(createHudTakeoverQueue());
  let phaseTimer: ReturnType<typeof setTimeout> | undefined;

  const reducedMotion = watchReducedMotion();

  function applyQueue(next: HudTakeoverQueueState) {
    queue = next;
    clearTimeout(phaseTimer);
    const deadline = nextTakeoverDeadline(next);
    if (deadline !== null) {
      phaseTimer = setTimeout(() => {
        applyQueue(tickTakeoverQueue(queue, Date.now()));
      }, Math.max(0, deadline - Date.now()));
    }
  }

  function handleTrigger(trigger: HudTakeoverTrigger) {
    applyQueue(enqueueTakeover(tickTakeoverQueue(queue, Date.now()), trigger, Date.now()));
  }

  function handleDismiss() {
    applyQueue(dismissTakeover(queue, Date.now()));
  }

  // Manual card-click requests arrive via the hud slice; consume + clear.
  const takeoverRequest$ = selectHudTakeoverRequestWorkspaceId();
  $effect(() => {
    const workspaceId = $takeoverRequest$;
    if (!workspaceId) return;
    appStore.dispatch(hudTakeoverRequestCleared());
    applyQueue(
      requestImmediateTakeover(
        tickTakeoverQueue(queue, Date.now()),
        {
          workspaceId,
          kind: 'manual',
          detail: '',
          raisedAtMs: Date.now(),
          changedTaskId: null,
        },
        Date.now(),
      ),
    );
  });

  onMount(() => {
    const unsubscribe = onTakeoverTrigger(handleTrigger);
    return () => {
      unsubscribe();
      clearTimeout(phaseTimer);
      reducedMotion.cleanup();
    };
  });

  // ── View data for the active workspace ──
  const activeWorkspaceIdStore = writable('');
  $effect(() => {
    activeWorkspaceIdStore.set(queue.active?.workspaceId ?? '');
  });
  const view$ = selectHudTakeoverView(activeWorkspaceIdStore);

  // Refresh the map's rollups when a takeover opens (idempotent triggers;
  // the daemon-events bridge keeps them fresh afterwards).
  $effect(() => {
    const workspaceId = queue.active?.workspaceId;
    if (!workspaceId) return;
    appStore.dispatch(ensureWorkspaceTasksLoaded(workspaceId));
    appStore.dispatch(hydrateTaskAgentAssociationsRequested(workspaceId));
  });

  // ── Derived choreography state ──
  const visible = $derived(queue.phase !== 'idle' && $view$ !== null);
  const closing = $derived(queue.phase === 'closing');
  const motion = $derived(!reducedMotion.current);
  const isViewer = $derived(queue.active?.isViewer === true);
  const primaryTrigger = $derived(activeTakeoverTrigger(queue));
  const countdown = $derived(takeoverCountdownSeconds(queue, nowMs));

  /** Map cells: task list placed on the deterministic spiral. */
  const mapCells = $derived.by(() => {
    const view = $view$;
    if (!view) return [];
    const coords = spiralCoords(view.tasks.length);
    return view.tasks.map((task, i) => ({ task, coord: coords[i] }));
  });

  /** Coord of the changed task (newest trigger), null when none/absent. */
  const changedCoord = $derived.by(() => {
    const changedTaskId = primaryTrigger?.changedTaskId;
    if (!changedTaskId) return null;
    return mapCells.find((cell) => cell.task.id === changedTaskId)?.coord ?? null;
  });

  /** Empty dashed cells filling the canvas ring around the occupied grid. */
  const emptyCells = $derived.by(() => {
    const { minX, maxX, minY, maxY } = canvasBounds(mapCells.map((cell) => cell.coord));
    const occupied = new Set(mapCells.map((cell) => `${cell.coord.x},${cell.coord.y}`));
    occupied.add('0,0');
    const empties: { x: number; y: number }[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!occupied.has(`${x},${y}`)) empties.push({ x, y });
      }
    }
    return empties;
  });

  // Pan to the changed cell when it sits outside the base viewport (mock:
  // 2s after open). Reduced motion pans immediately without transition.
  let pan = $state({ x: 0, y: 0 });
  let panTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const workspaceId = queue.active?.workspaceId;
    const coord = changedCoord;
    clearTimeout(panTimer);
    pan = { x: 0, y: 0 };
    if (!workspaceId || !coord || !cellNeedsPan(coord)) return;
    if (!motion) {
      pan = { x: coord.x, y: coord.y };
      return;
    }
    panTimer = setTimeout(() => {
      pan = { x: coord.x, y: coord.y };
    }, 2000);
  });
  const needsPan = $derived(changedCoord !== null && cellNeedsPan(changedCoord));

  /** Spec-progress segments (mock `taskSegs`): done → inProgress → rest. */
  const specSegments = $derived.by(() => {
    const stats = $view$?.stats;
    if (!stats || stats.total === 0) return [];
    const count = Math.min(stats.total, 24);
    const done = Math.round((stats.completed / stats.total) * count);
    const active = Math.round(((stats.completed + stats.inProgress) / stats.total) * count);
    return Array.from({ length: count }, (_, i) => {
      if (i < done) return 'hsl(var(--primary))';
      if (i < active) return 'hsl(var(--ring))';
      return 'hsl(var(--muted))';
    });
  });

  function cellLeft(x: number): string {
    return `${x * HUD_TAKEOVER_PITCH_PX - HUD_TAKEOVER_CELL_PX / 2}px`;
  }
  function cellTop(y: number): string {
    return `${y * HUD_TAKEOVER_PITCH_PX - HUD_TAKEOVER_CELL_PX / 2}px`;
  }

  /** Localized WHAT CHANGED line for a trigger (labels off `kind`). */
  function changeLine(trigger: HudTakeoverTrigger): string {
    return trigger.detail
      ? `${takeoverKindLabel(trigger.kind)} · ${trigger.detail}` // i18n-ignore (label + wire detail join)
      : takeoverKindLabel(trigger.kind);
  }

  function elapsedText(agent: HudCardAgent): string {
    if (!agent.lastActivityTs) return '--:--:--'; // i18n-ignore (digit placeholder)
    const startedMs = Date.parse(agent.lastActivityTs);
    if (!Number.isFinite(startedMs)) return '--:--:--'; // i18n-ignore (digit placeholder)
    return formatHudTimer((nowMs - startedMs) / 1000);
  }

  /** Banner delay per mock: 3.5s when panning, 1.0s otherwise, +0.3s each. */
  function bannerDelay(index: number): string {
    return ((needsPan ? 3.5 : 1.0) + index * 0.3).toFixed(1);
  }
</script>

{#if visible && $view$}
  {@const view = $view$}
  <div
    class="ov-root"
    class:ov-closing={closing}
    class:ov-no-motion={!motion}
    data-testid="hud-takeover-overlay"
  >
    <div class="ov-backdrop"></div>
    <div class="ov-frame">
      <div class="ov-fill"></div>
      <div class="ov-edge-h ov-edge-top"></div>
      <div class="ov-edge-h ov-edge-bottom"></div>
      <div class="ov-edge-v ov-edge-left"></div>
      <div class="ov-edge-v ov-edge-right"></div>
      {#each ['tl', 'tr', 'bl', 'br'] as corner (corner)}
        <div
          class="ov-corner ov-corner-{corner}"
          style:border-color={takeoverKindColor(primaryTrigger?.kind ?? 'manual')}
        ></div>
      {/each}
      <div class="ov-ruler ov-ruler-top"></div>
      <div class="ov-ruler ov-ruler-bottom"></div>

      <div class="ov-content">
        <!-- Header: title / spec progress / countdown / DISMISS -->
        <div class="ov-header">
          <div class="ov-heading">
            <span class="ov-ws-name">{view.title}</span>
            <span class="ov-ws-repo">{view.repoRef}</span>
          </div>
          <div class="ov-divider"></div>
          <div class="ov-progress">
            <div class="ov-progress-row">
              <span>{m.hud_takeover_specProgress_label()}</span>
              <span>
                <!-- i18n-ignore (digit-only progress interpolation) -->
                {m.hud_card_tasks_label({
                  progress: `${view.stats.completed}/${view.stats.total}`,
                })}
              </span>
            </div>
            <div class="ov-progress-segs">
              {#each specSegments as seg, i (i)}
                <div class="ov-progress-seg" style:background={seg}></div>
              {/each}
            </div>
          </div>
          <div class="ov-spacer"></div>
          {#if !isViewer}
            <span class="ov-return" data-testid="hud-takeover-return">
              {m.hud_takeover_return_label({ seconds: String(countdown).padStart(2, '0') })}
            </span>
          {/if}
          <button class="ov-dismiss" onclick={handleDismiss} data-testid="hud-takeover-dismiss">
            {m.hud_takeover_dismiss_label()}
          </button>
        </div>

        <div class="ov-main">
          <!-- Left: STATUS line + task map + banners -->
          <div class="ov-map-col">
            <div class="ov-status-row">
              <span class="ov-status-tag">{m.hud_takeover_status_label()}</span>
              <span class="ov-status-text">
                {view.statusMessage ?? m.hud_card_idleNoAgents_label()}
              </span>
            </div>
            <div class="ov-map-outer">
              <div class="ov-map-clip">
                <div
                  class="ov-map-pan"
                  style:transform={`translate(${-pan.x * HUD_TAKEOVER_PITCH_PX}px, ${-pan.y * HUD_TAKEOVER_PITCH_PX}px)`}
                  class:ov-map-pan-animate={motion && (pan.x !== 0 || pan.y !== 0)}
                >
                  <!-- Spec cell anchored at (0,0) -->
                  <div class="ov-cell ov-cell-spec" style:left={cellLeft(0)} style:top={cellTop(0)}>
                    <div class="ov-spec-tag">{m.hud_takeover_spec_label()}</div>
                    <div class="ov-spec-title">{view.title}</div>
                    <div class="ov-spec-segs">
                      {#each specSegments as seg, i (i)}
                        <div class="ov-progress-seg" style:background={seg}></div>
                      {/each}
                    </div>
                    <div class="ov-spec-prog">
                      <!-- i18n-ignore (digit-only progress interpolation) -->
                      {m.hud_card_tasks_label({
                        progress: `${view.stats.completed}/${view.stats.total}`,
                      })}
                    </div>
                  </div>

                  {#each emptyCells as cell (`${cell.x},${cell.y}`)}
                    <div
                      class="ov-cell ov-cell-empty"
                      style:left={cellLeft(cell.x)}
                      style:top={cellTop(cell.y)}
                    ></div>
                  {/each}

                  {#each mapCells as { task, coord }, i (task.id)}
                    {@const meta = taskCellMeta(task.status)}
                    {@const changed = primaryTrigger?.changedTaskId === task.id}
                    <div
                      class="ov-cell ov-cell-task"
                      class:ov-cell-changed={changed}
                      style:left={cellLeft(coord.x)}
                      style:top={cellTop(coord.y)}
                      style:border={`1px ${meta.borderStyle} ${changed ? meta.color : meta.borderColor}`}
                      style:background={meta.bg}
                      style:outline-color={changed ? meta.color : 'transparent'}
                      style:animation-delay={motion ? `${(0.9 + i * 0.012).toFixed(2)}s` : '0s'}
                      data-testid="hud-takeover-cell"
                    >
                      <div class="ov-cell-head">
                        <span
                          class="ov-cell-dot"
                          class:ov-anim-pulse={motion && task.status === 'in_progress'}
                          style:background={meta.color}
                        ></span>
                        <span class="ov-cell-state" style:color={meta.color}>{meta.label}</span>
                      </div>
                      <div class="ov-cell-title">{task.title}</div>
                      <div class="ov-cell-agents">
                        {#each task.agents as agent (agent.id)}
                          <span class="ov-cell-agent">
                            <span
                              class="ov-cell-agent-dot"
                              class:ov-anim-pulse={motion && agent.bucket === 'running'}
                              style:background={agentBucketColor(agent.bucket)}
                            ></span>
                            {agent.name}
                            <span style:color={agentBucketColor(agent.bucket)}>
                              {agentBucketLabel(agent.bucket)}
                            </span>
                          </span>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>

              <!-- Banners: one per accumulated trigger, typewriter wipe.
                   A manual VIEWER renders no event-banner treatment. -->
              {#if queue.active && !isViewer}
                <div class="ov-banners">
                  {#each queue.active.triggers as banner, i (`${banner.kind}-${banner.raisedAtMs}-${i}`)}
                    {@const color = takeoverKindColor(banner.kind)}
                    <div
                      class="ov-banner"
                      style:animation-delay={motion ? `${bannerDelay(i)}s` : '0s'}
                      data-testid="hud-takeover-banner"
                    >
                      <span
                        class="ov-banner-chip"
                        class:ov-anim-blink={motion}
                        style:border-color={color}
                        style:color
                      >
                        {takeoverKindLabel(banner.kind)}
                      </span>
                      {#if banner.detail}
                        <!-- Question banners carry full sentence text (§7.1
                             question payload): wrap instead of clipping. -->
                        <div
                          class="ov-banner-big"
                          class:ov-banner-big-wrap={banner.kind === 'question_asked'}
                          style:color
                          style:--banner-color={color}
                        >
                          {banner.detail}
                        </div>
                      {/if}
                      <div class="ov-banner-sub">{view.repoRef}</div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>

          <!-- Right: WHAT CHANGED / ACTIVE AGENTS / IDLE AGENTS -->
          <div class="ov-side">
            <div class="ov-panel">
              <div class="ov-panel-head">
                <span>{m.hud_takeover_whatChanged_title()}</span>
                <span class="ov-panel-rule"></span>
              </div>
              <div class="ov-panel-body ov-changes">
                {#if queue.active}
                  {#each queue.active.triggers.slice().reverse() as change, i (`${change.kind}-${change.raisedAtMs}-${i}`)}
                    <div class="ov-change">
                      <span style:color={takeoverKindColor(change.kind)}>▸</span>
                      <span class="ov-change-text">{changeLine(change)}</span>
                    </div>
                  {/each}
                {/if}
              </div>
            </div>

            <div class="ov-panel">
              <div class="ov-panel-head">
                <span>{m.hud_takeover_activeAgents_title()}</span>
                <span class="ov-panel-rule"></span>
                <span class="ov-panel-count">{view.activeAgents.length}</span>
              </div>
              <div class="ov-panel-body ov-agents">
                {#each view.activeAgents as agent (agent.id)}
                  <div class="ov-agent">
                    <div class="ov-agent-row">
                      <span
                        class="ov-agent-dot"
                        class:ov-anim-pulse={motion && agent.bucket === 'running'}
                        class:ov-anim-blink={motion && agent.bucket === 'waiting'}
                        style:background={agentBucketColor(agent.bucket)}
                      ></span>
                      <span class="ov-agent-name">{agent.name}</span>
                      <span class="ov-agent-elapsed">{elapsedText(agent)}</span>
                      <span class="ov-agent-state" style:color={agentBucketColor(agent.bucket)}>
                        {agentBucketLabel(agent.bucket)}
                      </span>
                    </div>
                    {#if agent.line}
                      <div class="ov-agent-note">{agent.line}</div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>

            <div class="ov-panel">
              <div class="ov-panel-head">
                <span>{m.hud_takeover_idleAgents_title()}</span>
                <span class="ov-panel-rule"></span>
                <span class="ov-panel-count">{view.idleAgents.length}</span>
              </div>
              <div class="ov-panel-body ov-agents">
                {#each view.idleAgents as agent (agent.id)}
                  <div class="ov-agent">
                    <div class="ov-agent-row">
                      <span
                        class="ov-agent-dot"
                        style:background={agentBucketColor(agent.bucket)}
                      ></span>
                      <span class="ov-agent-name">{agent.name}</span>
                      <span class="ov-agent-state" style:color={agentBucketColor(agent.bucket)}>
                        {agentBucketLabel(agent.bucket)}
                      </span>
                    </div>
                  </div>
                {/each}
              </div>
            </div>

            <div class="ov-side-spacer"></div>
            <div class="ov-side-footer">
              <span>{m.hud_takeover_footerMap_label()}</span>
              <span>{m.hud_takeover_footerSpec_label()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Wipe keyframes (mock ovh/ovv/ovf/ovc + reverse) ── */
  @keyframes ovh {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }
  @keyframes ovv {
    from {
      transform: scaleY(0);
    }
    to {
      transform: scaleY(1);
    }
  }
  @keyframes ovf {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes ovfO {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  @keyframes ovc {
    from {
      opacity: 0;
      transform: scale(0.3);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes ovcO {
    from {
      opacity: 1;
      transform: none;
    }
    to {
      opacity: 0;
      transform: scale(0.3);
    }
  }
  @keyframes conquerin {
    from {
      opacity: 0;
      transform: scale(0.93);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes bannerin {
    from {
      clip-path: inset(0 100% 0 0);
    }
    to {
      clip-path: inset(0 0 0 0);
    }
  }
  @keyframes ovringblink {
    50% {
      outline-color: transparent;
    }
  }

  .ov-root {
    position: absolute;
    inset: 0;
    z-index: 50;
  }
  .ov-backdrop {
    position: absolute;
    inset: 0;
    background: hsl(var(--app-background) / 0.55);
    backdrop-filter: blur(3px);
    animation: ovf 0.3s ease both;
  }
  .ov-frame {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(1560px, calc(100% - 120px));
    height: min(850px, calc(100% - 120px));
    display: flex;
    flex-direction: column;
  }
  .ov-fill {
    position: absolute;
    inset: 0;
    background: hsl(var(--card) / 0.98);
    box-shadow: 0 24px 80px hsl(var(--app-background) / 0.8);
    animation: ovf 0.25s ease 0.12s both;
  }
  .ov-edge-h {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: hsl(var(--border));
    animation: ovh 0.32s cubic-bezier(0.16, 1, 0.3, 1) 0.5s both;
  }
  .ov-edge-top {
    top: 0;
  }
  .ov-edge-bottom {
    bottom: 0;
  }
  .ov-edge-v {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: hsl(var(--border));
    animation: ovv 0.3s cubic-bezier(0.16, 1, 0.3, 1) 0.6s both;
  }
  .ov-edge-left {
    left: 0;
  }
  .ov-edge-right {
    right: 0;
  }
  .ov-corner {
    position: absolute;
    width: 22px;
    height: 22px;
    animation: ovc 0.2s ease 0.78s both;
  }
  .ov-corner-tl {
    top: -2px;
    left: -2px;
    border-top: 2px solid;
    border-left: 2px solid;
  }
  .ov-corner-tr {
    top: -2px;
    right: -2px;
    border-top: 2px solid;
    border-right: 2px solid;
  }
  .ov-corner-bl {
    bottom: -2px;
    left: -2px;
    border-bottom: 2px solid;
    border-left: 2px solid;
  }
  .ov-corner-br {
    bottom: -2px;
    right: -2px;
    border-bottom: 2px solid;
    border-right: 2px solid;
  }
  .ov-ruler {
    position: absolute;
    left: 40px;
    right: 40px;
    height: 3px;
    background: repeating-linear-gradient(90deg, hsl(var(--border)) 0 1px, transparent 1px 24px);
    animation: ovf 0.25s ease 0.82s both;
  }
  .ov-ruler-top {
    top: 3px;
  }
  .ov-ruler-bottom {
    bottom: 3px;
  }
  .ov-content {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    animation: ovf 0.3s ease 0.86s both;
  }

  /* Reverse wipe (mock ovClosing timings). */
  .ov-closing .ov-backdrop {
    animation: ovfO 0.3s ease 0.55s both;
  }
  .ov-closing .ov-fill,
  .ov-closing .ov-edge-h,
  .ov-closing .ov-edge-v {
    animation: ovfO 0.2s ease 0.62s both;
  }
  .ov-closing .ov-corner {
    animation: ovcO 0.15s ease 0.1s both;
  }
  .ov-closing .ov-ruler {
    animation: ovfO 0.15s ease 0.05s both;
  }
  .ov-closing .ov-content {
    animation: ovfO 0.18s ease both;
  }

  /* ── Header ── */
  .ov-header {
    position: relative;
    display: flex;
    align-items: center;
    gap: 16px;
    height: 66px;
    padding: 0 26px;
    border-bottom: 1px solid hsl(var(--border) / 0.8);
    flex: none;
  }
  .ov-heading {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .ov-ws-name {
    font:
      600 16px Inter,
      system-ui,
      sans-serif;
    letter-spacing: -0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 380px;
  }
  .ov-ws-repo {
    font: 500 10px 'JetBrains Mono', monospace;
    color: hsl(var(--text-subtle));
  }
  .ov-divider {
    width: 1px;
    height: 30px;
    background: hsl(var(--border));
  }
  .ov-progress {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 240px;
  }
  .ov-progress-row {
    display: flex;
    justify-content: space-between;
    font: 500 9px 'JetBrains Mono', monospace;
    color: hsl(var(--text-ghost));
  }
  .ov-progress-segs {
    display: flex;
    gap: 2px;
  }
  .ov-progress-seg {
    flex: 1;
    height: 5px;
  }
  .ov-spacer {
    flex: 1;
  }
  .ov-return {
    font: 500 12px 'JetBrains Mono', monospace;
    color: hsl(var(--text-ghost));
  }
  .ov-dismiss {
    cursor: pointer;
    border: 1px solid hsl(var(--border));
    background: transparent;
    padding: 6px 12px;
    font: 600 10px 'JetBrains Mono', monospace;
    letter-spacing: 0.12em;
    color: hsl(var(--text-subtle));
    text-transform: uppercase;
  }
  .ov-dismiss:hover {
    background: hsl(var(--muted) / 0.5);
  }

  /* ── Main grid ── */
  .ov-main {
    position: relative;
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 300px;
    min-height: 0;
  }
  .ov-map-col {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .ov-status-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 20px 0 22px;
    font: 500 11px 'JetBrains Mono', monospace;
  }
  .ov-status-tag {
    font:
      600 9px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.18em;
    color: hsl(var(--text-ghost));
    flex: none;
  }
  .ov-status-text {
    color: hsl(var(--text-subtle));
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-height: 1.45;
    padding: 2px 6px;
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
  }
  .ov-map-outer {
    position: relative;
    flex: 1;
    padding: 12px 20px 22px 22px;
    min-height: 0;
  }
  .ov-map-clip {
    position: relative;
    height: 100%;
    overflow: hidden;
  }
  .ov-map-pan {
    position: absolute;
    left: 50%;
    top: 50%;
  }
  .ov-map-pan-animate {
    transition: transform 1.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* ── Cells ── */
  .ov-cell {
    position: absolute;
    width: 180px;
    height: 180px;
    box-sizing: border-box;
    overflow: hidden;
    animation: conquerin 0.4s ease both;
  }
  .ov-cell-empty {
    border: 1px dashed hsl(var(--border) / 0.45);
    background: transparent;
  }
  .ov-cell-spec {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px;
    border: 3px double hsl(var(--foreground) / 0.5);
    background: hsl(var(--muted) / 0.45);
  }
  .ov-spec-tag {
    font:
      600 9px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.3em;
    color: hsl(var(--text-subtle));
  }
  .ov-spec-title {
    font:
      600 11px Inter,
      system-ui,
      sans-serif;
    letter-spacing: -0.01em;
    text-align: center;
    line-height: 1.3;
  }
  .ov-spec-segs {
    display: flex;
    gap: 2px;
    width: 80%;
  }
  .ov-spec-prog {
    font: 500 10px 'JetBrains Mono', monospace;
    color: hsl(var(--text-ghost));
  }
  .ov-cell-task {
    display: flex;
    flex-direction: column;
    padding: 7px 9px;
    gap: 3px;
    outline: 2px solid transparent;
    outline-offset: 3px;
  }
  .ov-cell-changed {
    animation:
      conquerin 0.4s ease both,
      ovringblink 0.9s step-end 1s infinite;
  }
  .ov-cell-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 600 8px 'JetBrains Mono', monospace;
    letter-spacing: 0.08em;
  }
  .ov-cell-dot {
    width: 5px;
    height: 5px;
    flex: none;
  }
  .ov-cell-state {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ov-cell-title {
    font:
      600 10.5px Inter,
      system-ui,
      sans-serif;
    letter-spacing: -0.01em;
    line-height: 1.25;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .ov-cell-agents {
    margin-top: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .ov-cell-agent {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--card) / 0.85);
    padding: 1px 5px;
    font: 500 8px 'JetBrains Mono', monospace;
    white-space: nowrap;
    overflow: hidden;
  }
  .ov-cell-agent-dot {
    width: 4px;
    height: 4px;
    flex: none;
  }

  /* ── Banners ── */
  .ov-banners {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .ov-banner {
    border-top: 1px solid hsl(var(--border) / 0.8);
    border-bottom: 1px solid hsl(var(--border) / 0.8);
    background: hsl(var(--app-background) / 0.88);
    padding: 14px 22px;
    animation: bannerin 1.1s steps(22) both;
  }
  .ov-banner-chip {
    display: inline-block;
    border: 1px solid;
    padding: 4px 11px;
    margin-bottom: 10px;
    font: 600 10px 'JetBrains Mono', monospace;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .ov-banner-big {
    font: 600 42px 'JetBrains Mono', monospace;
    letter-spacing: 0.14em;
    line-height: 1.05;
    background-image: radial-gradient(circle, var(--banner-color) 1.4px, transparent 1.7px);
    background-size: 6px 6px;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    white-space: nowrap;
    overflow: hidden;
    text-transform: uppercase;
  }
  .ov-banner-big-wrap {
    font-size: 24px;
    white-space: normal;
    text-transform: none;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
  .ov-banner-sub {
    margin-top: 6px;
    font: 500 11.5px 'JetBrains Mono', monospace;
    letter-spacing: 0.18em;
    color: hsl(var(--text-subtle));
    text-transform: uppercase;
  }

  /* ── Side column ── */
  .ov-side {
    position: relative;
    border-left: 1px solid hsl(var(--border) / 0.8);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    min-height: 0;
    overflow: hidden;
  }
  .ov-panel {
    border: 1px solid hsl(var(--border) / 0.8);
    background: hsl(var(--card) / 0.8);
  }
  .ov-panel-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-bottom: 1px solid hsl(var(--border) / 0.5);
    font:
      600 10px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.18em;
    color: hsl(var(--text-subtle));
    text-transform: uppercase;
  }
  .ov-panel-rule {
    flex: 1;
    height: 1px;
    background: hsl(var(--border) / 0.6);
  }
  .ov-panel-count {
    font: 500 9px 'JetBrains Mono', monospace;
    color: hsl(var(--text-ghost));
  }
  .ov-panel-body {
    display: flex;
    flex-direction: column;
    padding: 11px 12px;
  }
  .ov-changes {
    gap: 8px;
    font: 500 10.5px 'JetBrains Mono', monospace;
    line-height: 1.5;
  }
  .ov-change {
    display: flex;
    gap: 8px;
  }
  .ov-change-text {
    color: hsl(var(--text-subtle));
  }
  .ov-agents {
    gap: 10px;
  }
  .ov-agent {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ov-agent-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font: 500 11px 'JetBrains Mono', monospace;
  }
  .ov-agent-dot {
    width: 6px;
    height: 6px;
    flex: none;
  }
  .ov-agent-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ov-agent-elapsed {
    margin-left: auto;
    color: hsl(var(--text-ghost));
    font-size: 9.5px;
  }
  .ov-agent-state {
    font-size: 9.5px;
  }
  .ov-agent-note {
    font: 500 10px 'JetBrains Mono', monospace;
    color: hsl(var(--text-subtle));
    padding-left: 13px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .ov-side-spacer {
    flex: 1;
  }
  .ov-side-footer {
    font: 500 9px 'JetBrains Mono', monospace;
    letter-spacing: 0.12em;
    color: hsl(var(--text-ghost));
    display: flex;
    gap: 14px;
  }

  .ov-anim-pulse {
    animation: hudpulse 2.1s ease-in-out infinite;
  }
  .ov-anim-blink {
    animation: hudblink 1.6s step-end infinite;
  }

  /* ── Reduced motion: skip every animation, content shows immediately ── */
  .ov-no-motion .ov-backdrop,
  .ov-no-motion .ov-fill,
  .ov-no-motion .ov-edge-h,
  .ov-no-motion .ov-edge-v,
  .ov-no-motion .ov-corner,
  .ov-no-motion .ov-ruler,
  .ov-no-motion .ov-content,
  .ov-no-motion .ov-cell,
  .ov-no-motion .ov-banner {
    animation: none;
  }
  .ov-no-motion .ov-map-pan {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .ov-backdrop,
    .ov-fill,
    .ov-edge-h,
    .ov-edge-v,
    .ov-corner,
    .ov-ruler,
    .ov-content,
    .ov-cell,
    .ov-banner,
    .ov-anim-pulse,
    .ov-anim-blink {
      animation: none;
    }
    .ov-map-pan {
      transition: none;
    }
  }
</style>
