<script lang="ts">
  /**
   * HUD takeover overlay (mock lines 239-358) — the full-screen event
   * spotlight: card pre-roll blink + FLIP zoom out of the source card
   * (mock `ovPend`/`ovFrom`), wipe-in choreography, typewriter banner,
   * task-map canvas, WHAT CHANGED list, agent rosters, RETURN countdown and
   * DISMISS (the close collapses back into the card). Sequenced by the pure
   * takeover queue: bursts enqueue, duplicates coalesce, DISMISS skips
   * ahead. A manual card-click opens a VIEWER entry (queue `isViewer`) with
   * the same blink/zoom but no banners/countdown — open until DISMISS.
   * Reduced motion skips every animation (no blink, instant open).
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
    takeoverCountdownSeconds,
    takeoverDwellMs,
    type HudTakeoverTrigger,
  } from './hud-takeover-queue';
  import { createTakeoverController } from './hud-takeover-controller.svelte';
  import { takeoverFrameStyle } from './hud-takeover-frame';
  import {
    bannerScrollDurationS,
    cellLeft,
    cellNeedsPan,
    cellTop,
    emptyCellCoords,
    spiralCoords,
    takeoverPanBounds,
  } from './hud-takeover-layout';
  import { createTakeoverMapDrag } from './hud-takeover-drag.svelte';
  import {
    agentBucketLabel,
    takeoverKindColor,
    takeoverKindLabel,
    taskCellMeta,
  } from './hud-takeover-meta';
  import HudTakeoverBanner from './HudTakeoverBanner.svelte';
  import { agentBucketColor } from '../grid/hud-card-meta';

  let { nowMs }: { nowMs: number } = $props();

  // ── Queue + blink/zoom wiring (controller owns timers and $effects) ──
  const reducedMotion = watchReducedMotion();
  const controller = createTakeoverController(() => reducedMotion.current);
  const queue = $derived(controller.queue);

  function handleDismiss() {
    controller.dismiss();
  }

  // Manual card-click requests arrive via the hud slice; consume + clear.
  const takeoverRequest$ = selectHudTakeoverRequestWorkspaceId();
  $effect(() => {
    const workspaceId = $takeoverRequest$;
    if (!workspaceId) return;
    appStore.dispatch(hudTakeoverRequestCleared());
    controller.openViewer({
      workspaceId,
      kind: 'manual',
      detail: '',
      raisedAtMs: Date.now(),
      changedTaskId: null,
    });
  });

  onMount(() => {
    const unsubscribe = onTakeoverTrigger((trigger) => controller.enqueue(trigger));
    return () => {
      unsubscribe();
      controller.destroy();
      drag.destroy();
      reducedMotion.cleanup();
    };
  });

  // ── View data for the active workspace ──
  const activeWorkspaceIdStore = writable('');
  $effect(() => {
    activeWorkspaceIdStore.set(queue.active?.workspaceId ?? '');
  });
  const view$ = selectHudTakeoverView(activeWorkspaceIdStore);

  // Refresh the map's rollups on open (idempotent; the events bridge keeps them fresh).
  $effect(() => {
    const workspaceId = queue.active?.workspaceId;
    if (!workspaceId) return;
    appStore.dispatch(ensureWorkspaceTasksLoaded(workspaceId));
    appStore.dispatch(hydrateTaskAgentAssociationsRequested(workspaceId));
  });

  // ── Derived choreography state ──
  // The pre-roll blink shows only the card flash — the overlay stays hidden.
  const visible = $derived(
    queue.phase !== 'idle' && queue.phase !== 'blinking' && $view$ !== null,
  );
  const closing = $derived(queue.phase === 'closing');
  const motion = $derived(!reducedMotion.current);
  const frameStyle = $derived(
    takeoverFrameStyle(controller.frameFrom, { closing, zoom: controller.zoom, motion }),
  );
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
  const emptyCells = $derived(emptyCellCoords(mapCells.map((cell) => cell.coord)));

  // Map camera: manual drag-to-pan + the auto-pan to a far changed cell
  // (mock: 2s after open; reduced motion pans immediately, drags stay live).
  const panBounds = $derived(takeoverPanBounds(mapCells.map((cell) => cell.coord)));
  const drag = createTakeoverMapDrag(() => panBounds);
  const needsPan = $derived(changedCoord !== null && cellNeedsPan(changedCoord));
  $effect(() => {
    const workspaceId = queue.active?.workspaceId ?? '';
    drag.syncAutoPan(workspaceId, needsPan ? changedCoord : null, motion ? 2000 : 0);
  });

  // ── Banner overflow marquee: measure once per display during 'opening' ──
  // `.ov-banner-big` is nowrap + hidden overflow, so `scrollWidth −
  // clientWidth` is the marquee travel. Measured per rendered banner (wrap
  // headlines excluded — they clamp, never scroll); the MAX scroll duration
  // is reported to the controller BEFORE the opening→dwelling tick so the
  // queue dwell covers the whole scroll (`extraDwellMs`). Keyed per display
  // like the controller's zoom measurement; reduced motion reports 0.
  let bannersEl = $state<HTMLElement | null>(null);
  let bannerOverflows = $state<number[]>([]);
  let scrollMeasureKey = '';
  $effect(() => {
    if (queue.phase !== 'opening' || !queue.active || isViewer) {
      scrollMeasureKey = '';
      if (queue.phase === 'idle' && bannerOverflows.length > 0) bannerOverflows = [];
      return;
    }
    if (queue.active.workspaceId === scrollMeasureKey || !bannersEl) return;
    scrollMeasureKey = queue.active.workspaceId;
    if (!motion) {
      bannerOverflows = [];
      return;
    }
    const next = Array.from(bannersEl.querySelectorAll('.ov-banner')).map((banner) => {
      const big = banner.querySelector('.ov-banner-big:not(.ov-banner-big-wrap)');
      return big ? Math.max(0, big.scrollWidth - big.clientWidth) : 0;
    });
    bannerOverflows = next;
    controller.reportBannerScrollMs(
      Math.round(Math.max(0, ...next.map((px) => bannerScrollDurationS(px))) * 1000),
    );
  });

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
    <div
      class="ov-frame"
      style:transform={frameStyle.transform}
      style:transition={frameStyle.transition}
      data-testid="hud-takeover-frame"
    >
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
              <span
                class="ov-status-text"
                class:ov-status-hint={motion && primaryTrigger?.kind === 'status_update'}
              >
                {view.statusMessage ?? m.hud_card_idleNoAgents_label()}
              </span>
            </div>
            <div class="ov-map-outer">
              <div
                class="ov-map-clip"
                class:ov-map-dragging={drag.dragging}
                data-testid="hud-takeover-map"
                {@attach drag.attach}
              >
                <div
                  class="ov-map-pan"
                  style:transform={`translate(${-drag.pan.x}px, ${-drag.pan.y}px)`}
                  class:ov-map-pan-animate={motion && drag.animate}
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
                      {#if task.status === 'complete' && task.report}
                        <!-- Agent completion report / task note content (wire content; i18n-exempt) -->
                        <div class="ov-cell-report" data-testid="hud-takeover-cell-report">
                          {task.report}
                        </div>
                      {/if}
                      <div class="ov-cell-agents">
                        {#each task.agents as agent (agent.id)}
                          <span class="ov-cell-agent">
                            <span
                              class="ov-cell-agent-dot"
                              class:ov-anim-pulse={motion && agent.bucket === 'running'}
                              class:ov-anim-blink={motion &&
                                (agent.bucket === 'needs-attention' || agent.bucket === 'failed')}
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

              <!-- Banners: one per trigger, typewriter wipe; VIEWER renders none.
                   Rendering (chip/headline/marquee + styles) lives in
                   HudTakeoverBanner.svelte; this overlay measures the
                   headline overflow (see the measurement $effect) and feeds
                   each banner its overflowPx. -->
              {#if queue.active && !isViewer}
                {@const dwellMs = takeoverDwellMs(queue.active)}
                <div class="ov-banners" bind:this={bannersEl}>
                  {#each queue.active.triggers as banner, i (`${banner.kind}-${banner.raisedAtMs}-${i}`)}
                    <HudTakeoverBanner
                      {banner}
                      index={i}
                      title={view.title}
                      repoRef={view.repoRef}
                      {motion}
                      {needsPan}
                      {dwellMs}
                      overflowPx={bannerOverflows[i] ?? 0}
                    />
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
                        class:ov-anim-blink={motion && agent.bucket === 'needs-attention'}
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
  @keyframes ovringblink {
    50% {
      outline-color: transparent;
    }
  }
  /* Mock hudhintW: warning-tinted background flash on the STATUS line. */
  @keyframes ovhintw {
    0% {
      background: hsl(var(--warning) / 0.18);
    }
    100% {
      background: transparent;
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
  /* Mock statusAnim (statusChanged): warning hint flash + 2 blinks. */
  .ov-status-hint {
    animation:
      ovhintw 2.5s ease-out both,
      hudblink 1.6s step-end 2;
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
    cursor: grab;
    touch-action: none;
  }
  .ov-map-dragging {
    cursor: grabbing;
    user-select: none;
    -webkit-user-select: none;
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
  .ov-cell-report {
    /* Mock ghost body text: 8.5px mono at foreground/0.3. */
    font:
      500 8.5px 'JetBrains Mono',
      monospace;
    line-height: 1.5;
    color: hsl(var(--foreground) / 0.3);
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 8;
    white-space: pre-line;
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

  /* ── Banners (rows render in HudTakeoverBanner.svelte) ── */
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
  .ov-no-motion .ov-status-hint {
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
    .ov-status-hint,
    .ov-anim-pulse,
    .ov-anim-blink {
      animation: none;
    }
    .ov-map-pan {
      transition: none;
    }
  }
</style>
