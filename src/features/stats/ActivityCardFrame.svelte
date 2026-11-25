<script lang="ts">
  /**
   * Shared 360×640 frame for the activity cards (Code Written, Tool Calls,
   * Agent Team, Activity Streak): the Passport card's head, dashed rule and
   * "Built with Intent" footer, plus the hero / note / stat-grid classes the
   * cards fill in. `note` is the small tracked-since or upgrade line.
   */
  import type { Snippet } from 'svelte';
  import Logo from '$lib/components/Logo.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { StatsCardName } from './stats-export';

  let {
    card,
    title,
    label,
    loading = false,
    children,
  }: {
    card: StatsCardName;
    title: string;
    label: string;
    loading?: boolean;
    children: Snippet;
  } = $props();
</script>

<div class="activity-card" data-stats-card={card} data-loading={loading}>
  <div class="head">
    <div class="head-brand">
      <Logo width={26} />
      <span class="head-title">{title}</span>
    </div>
    <span class="head-label">{label}</span>
  </div>
  <div class="rule"></div>
  <div class="body">
    {@render children()}
  </div>
  <div class="foot">
    <span class="foot-brand">{m.stats_card_builtWith_label()}</span>
    <!-- i18n-ignore (brand URL) -->
    <span class="foot-url">intentapp.dev</span>
  </div>
</div>

<style>
  .activity-card {
    width: 360px;
    height: 640px;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 16px;
    color: hsl(var(--card-foreground));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--surface-shadow-3);
    box-sizing: border-box;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 22px 24px 17px;
  }
  .head-brand {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .head-title {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: hsl(var(--muted-foreground));
  }
  .head-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: hsl(var(--muted-foreground));
  }
  .rule {
    border-top: 1px dashed hsl(var(--border));
    margin: 0 0 5px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .activity-card :global(.mono) {
    font-family: 'JetBrains Mono', monospace;
  }
  .activity-card :global(.hero) {
    padding: 19px 24px 0;
  }
  .activity-card :global(.hero-label) {
    font-size: 12px;
    letter-spacing: 0.14em;
    color: hsl(var(--muted-foreground));
    margin-bottom: 7px;
  }
  .activity-card :global(.hero-value) {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1;
    white-space: nowrap;
  }
  .activity-card :global(.hero-sub) {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 17px;
    margin-top: 12px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    color: hsl(var(--muted-foreground));
    white-space: nowrap;
  }
  .activity-card :global(.note) {
    margin-top: 10px;
    font-size: 12px;
    color: hsl(var(--muted-foreground));
  }
  .activity-card :global(.visual) {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 18px 24px 0;
  }
  .activity-card :global(.legend) {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin-top: 10px;
    font-size: 12px;
    color: hsl(var(--muted-foreground));
    white-space: nowrap;
  }
  .activity-card :global(.legend-item) {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .activity-card :global(.swatch) {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex: none;
  }
  .activity-card :global(.split) {
    display: flex;
    gap: 2px;
    height: 10px;
    border-radius: 5px;
    overflow: hidden;
    background: hsl(var(--muted));
  }
  .activity-card :global(.split > span) {
    height: 100%;
  }
  .activity-card :global(.grid) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 17px 14px;
    padding: 22px 24px;
  }
  .activity-card :global(.stat-label) {
    font-size: 11px;
    letter-spacing: 0.14em;
    color: hsl(var(--muted-foreground));
  }
  .activity-card :global(.stat-big) {
    font-family: 'JetBrains Mono', monospace;
    font-size: 23px;
    margin-top: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .activity-card :global(.stat-small) {
    font-family: 'JetBrains Mono', monospace;
    font-size: 15px;
    margin-top: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .activity-card :global(.tone-success) {
    color: hsl(var(--success));
  }
  .activity-card :global(.tone-danger) {
    color: hsl(var(--danger));
  }
  .activity-card :global(.tone-primary) {
    color: hsl(var(--primary-ink));
  }
  .foot {
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 19px 24px 21px;
  }
  .foot-brand {
    font-size: 13px;
    opacity: 0.85;
  }
  .foot-url {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
  }
</style>
