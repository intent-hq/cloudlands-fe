<script lang="ts">
  /**
   * HUD right column (mock's 316px rail) — EVENT FEED (flex:1) over the
   * AGENT ACTIVITY · TOK/S chart and the TOKEN BURN panel (mock lines
   * 198-234). Self-contained: the panels read the hud slice selectors
   * directly; no props. The ATTENTION panel lives at the bottom of the left
   * column (mock placement) — see `AttentionPanel.svelte`.
   */
  import FeedPanel from './FeedPanel.svelte';
  import TokRatePanel from './TokRatePanel.svelte';
  import TokenBurnPanel from './TokenBurnPanel.svelte';
</script>

<div class="hud-right-column" data-testid="hud-right-column">
  <FeedPanel />
  <TokRatePanel />
  <TokenBurnPanel />
</div>

<style>
  .hud-right-column {
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100%;
    min-height: 0;
  }
</style>
