<script lang="ts">
  /**
   * One square workspace card (mock lines 149-193): corner brackets, status
   * banner (pulse on in_progress / blink on attention), title + repo line,
   * task segment bar, live-agent rows with elapsed timers and swapping
   * activity lines, attention strip, and the TOK / PR footer. Clicking
   * dispatches the takeover-overlay request into the hud slice. During the
   * takeover pre-roll the card flashes its outline 3 times (mock `ovPend` →
   * `wsflash .3s step-end 3`) before the overlay zooms out of it.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { hudTakeoverRequested } from '$store/renderer/slices/hud/hud-slice';
  import type { HudWorkspaceCard } from '$store/renderer/slices/hud/hud-selectors';
  import { formatHudTimer } from '../utils/hud-format';
  import { takeoverBlinkTarget } from '../takeover/hud-takeover-bus';
  import {
    agentBucketColor,
    cardStateColor,
    cardStateLabel,
    formatCardTokens,
  } from './hud-card-meta';
  import HudAgentLine from './HudAgentLine.svelte';

  let { card, nowMs }: { card: HudWorkspaceCard; nowMs: number } = $props();

  const color = $derived(cardStateColor(card.stateKey));
  const blinking = $derived($takeoverBlinkTarget === card.workspaceId);
  const isFailed = $derived(card.stateKey === 'failed');
  const isAttention = $derived(
    card.stateKey === 'wait' || card.stateKey === 'blocked' || isFailed,
  );

  /** Mock `taskSegs`: completed → in-progress → remaining segment colors. */
  const segments = $derived.by(() => {
    const { total, completed, inProgress } = card.tasks;
    const count = Math.max(total, 1);
    return Array.from({ length: Math.min(count, 24) }, (_, i) => {
      if (total === 0) return 'hsl(var(--muted))';
      const scaled = Math.min(count, 24);
      const done = Math.round((completed / total) * scaled);
      const active = Math.round(((completed + inProgress) / total) * scaled);
      if (i < done) return 'hsl(var(--primary))';
      if (i < active) return 'hsl(var(--ring))';
      return 'hsl(var(--muted))';
    });
  });

  function elapsedText(lastActivityTs: string | null): string {
    if (!lastActivityTs) return '--:--:--'; // i18n-ignore (digit placeholder)
    const startedMs = Date.parse(lastActivityTs);
    if (!Number.isFinite(startedMs)) return '--:--:--'; // i18n-ignore (digit placeholder)
    return formatHudTimer((nowMs - startedMs) / 1000);
  }

  function handleClick() {
    // Consumed by HudTakeoverOverlay: manual opens jump the takeover queue.
    appStore.dispatch(hudTakeoverRequested(card.workspaceId));
  }
</script>

<button
  class="hud-ws-card"
  class:hud-ws-card-flash={blinking}
  data-testid="hud-ws-card"
  data-workspace-id={card.workspaceId}
  onclick={handleClick}
  aria-label={m.hud_card_open_ariaLabel({ title: card.title })}
>
  {#if isFailed}
    <div class="hud-ws-card-hatch" aria-hidden="true"></div>
  {/if}
  <div class="hud-ws-card-corner hud-ws-card-corner-tl" style:border-color={color}></div>
  <div class="hud-ws-card-corner hud-ws-card-corner-br" style:border-color={color}></div>

  <div class="hud-ws-card-status">
    <span
      class="hud-ws-card-dot"
      class:hud-anim-pulse={card.stateKey === 'in_progress'}
      class:hud-anim-blink={isAttention}
      style:background={color}
    ></span>
    <span class="hud-ws-card-state" style:color>{cardStateLabel(card.stateKey)}</span>
  </div>

  <div class="hud-ws-card-heading">
    <div class="hud-ws-card-title">{card.title}</div>
    <div class="hud-ws-card-repo">{card.repoRef}</div>
  </div>

  <div class="hud-ws-card-tasks">
    <div class="hud-ws-card-segs">
      {#each segments as seg, i (i)}
        <div class="hud-ws-card-seg" style:background={seg}></div>
      {/each}
    </div>
    <span class="hud-ws-card-prog">
      <!-- i18n-ignore (digit-only progress interpolation) -->
      {m.hud_card_tasks_label({ progress: `${card.tasks.completed}/${card.tasks.total}` })}
    </span>
  </div>

  <div class="hud-ws-card-body">
    {#if card.agents.length === 0}
      <div class="hud-ws-card-summary">
        {card.statusMessage ?? m.hud_card_idleNoAgents_label()}
      </div>
    {:else}
      {#each card.agents as agent (agent.id)}
        {@const agentColor = agentBucketColor(agent.bucket)}
        <div class="hud-ws-card-agent">
          <div class="hud-ws-card-agent-row">
            {#if agent.treePrefix}
              <!-- i18n-ignore (box-drawing tree connector glyphs) -->
              <span class="hud-ws-card-agent-tree">{agent.treePrefix}</span>
            {/if}
            <span
              class="hud-ws-card-agent-dot"
              class:hud-anim-pulse={agent.bucket === 'running'}
              class:hud-anim-blink={agent.bucket === 'needs-attention'}
              style:background={agentColor}
            ></span>
            <span class="hud-ws-card-agent-name">{agent.name}</span>
            <span class="hud-ws-card-agent-elapsed">{elapsedText(agent.lastActivityTs)}</span>
          </div>
          {#if agent.line}
            <!-- Last-response line for every row (not just running): the swap
                 animation in HudAgentLine only plays when the line CHANGES,
                 which in practice is the running case. -->
            <div class="hud-ws-card-agent-msg" style:padding-left={`${agent.depth * 14 + 12}px`}>
              <HudAgentLine line={agent.line} />
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  {#if isAttention && card.statusMessage}
    <div class="hud-ws-card-question" style:border-color={color} style:color>
      {card.statusMessage}
    </div>
  {/if}

  <div class="hud-ws-card-footer">
    <span>{m.hud_card_tokens_label({ tokens: formatCardTokens(card.tokens) })}</span>
    <span class="hud-ws-card-footer-spacer"></span>
    {#if card.prNumber !== null}
      <span
        class="hud-ws-card-pr"
        style:border-color={card.stateKey === 'pr_merged' ? 'hsl(262 60% 62%)' : 'hsl(var(--ring))'}
        style:color={card.stateKey === 'pr_merged' ? 'hsl(262 60% 62%)' : 'hsl(var(--ring))'}
      >
        {m.hud_card_pr_label({ number: card.prNumber })}
      </span>
    {/if}
  </div>
</button>

<style>
  .hud-ws-card {
    position: relative;
    aspect-ratio: 1 / 1;
    border: 1px solid hsl(var(--border) / 0.8);
    background: hsl(var(--card));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    outline: 2px solid transparent;
    outline-offset: -1px;
    cursor: pointer;
    padding: 0;
    margin: 0;
    text-align: left;
    color: hsl(var(--foreground));
    font-family: Inter, system-ui, sans-serif;
  }
  .hud-ws-card-hatch {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      135deg,
      hsl(var(--destructive-foreground)) 0 2px,
      transparent 2px 14px
    );
    opacity: 0.07;
  }
  .hud-ws-card-corner {
    position: absolute;
    width: 11px;
    height: 11px;
    pointer-events: none;
  }
  .hud-ws-card-corner-tl {
    top: -1px;
    left: -1px;
    border-top: 2px solid;
    border-left: 2px solid;
  }
  .hud-ws-card-corner-br {
    bottom: -1px;
    right: -1px;
    border-bottom: 2px solid;
    border-right: 2px solid;
  }
  .hud-ws-card-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 3px;
  }
  .hud-ws-card-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .hud-ws-card-state {
    font:
      600 10px 'JetBrains Mono',
      monospace;
    letter-spacing: 0.12em;
  }
  .hud-ws-card-heading {
    padding: 0 12px;
  }
  .hud-ws-card-title {
    font:
      600 14.5px Inter,
      system-ui,
      sans-serif;
    letter-spacing: -0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hud-ws-card-repo {
    font:
      500 10px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-subtle));
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hud-ws-card-tasks {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px 0;
  }
  .hud-ws-card-segs {
    flex: 1;
    display: flex;
    gap: 2px;
  }
  .hud-ws-card-seg {
    flex: 1;
    height: 4px;
  }
  .hud-ws-card-prog {
    font:
      500 9px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
    white-space: nowrap;
  }
  .hud-ws-card-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 12px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .hud-ws-card-summary {
    font:
      500 11px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-subtle));
    line-height: 1.55;
    padding-top: 2px;
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
  }
  .hud-ws-card-agent {
    display: flex;
    flex-direction: column;
  }
  .hud-ws-card-agent-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font:
      500 10.5px 'JetBrains Mono',
      monospace;
    white-space: nowrap;
    line-height: 1.45;
  }
  .hud-ws-card-agent-tree {
    color: hsl(var(--text-ghost));
    white-space: pre;
    flex: none;
  }
  .hud-ws-card-agent-dot {
    width: 6px;
    height: 6px;
    flex: none;
  }
  .hud-ws-card-agent-name {
    color: hsl(var(--foreground));
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hud-ws-card-agent-elapsed {
    margin-left: auto;
    color: hsl(var(--text-ghost));
  }
  .hud-ws-card-agent-msg {
    padding-left: 12px;
  }
  .hud-ws-card-question {
    padding: 4px 12px;
    border-top: 1px dashed;
    font:
      500 10px 'JetBrains Mono',
      monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hud-ws-card-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 12px;
    border-top: 1px solid hsl(var(--border) / 0.5);
    font:
      500 10px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-subtle));
  }
  .hud-ws-card-footer-spacer {
    flex: 1;
  }
  .hud-ws-card-pr {
    display: inline-flex;
    border: 1px solid;
    border-radius: 999px;
    padding: 1px 9px;
  }
  .hud-anim-pulse {
    animation: hudpulse 2.1s ease-in-out infinite;
  }
  .hud-anim-blink {
    animation: hudblink 1.6s step-end infinite;
  }
  /* Takeover pre-roll flash (mock `wsflash .3s step-end 3`). */
  .hud-ws-card-flash {
    animation: hudwsflash 0.3s step-end 3;
  }
  @keyframes hudwsflash {
    0%,
    100% {
      outline-color: transparent;
    }
    50% {
      outline-color: hsl(var(--primary));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hud-anim-pulse,
    .hud-anim-blink,
    .hud-ws-card-flash {
      animation: none;
    }
  }
</style>
