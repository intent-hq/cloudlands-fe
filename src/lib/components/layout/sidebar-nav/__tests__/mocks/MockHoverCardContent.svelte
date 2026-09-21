<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    expanded?: boolean;
    collapsed?: boolean;
    ontoggle?: () => void;
    [key: string]: unknown;
  }

  let { expanded = false, collapsed = false, ontoggle }: Props = $props();
</script>

{#if ontoggle}
  <button
    type="button"
    aria-label={m.layout_chiefCard_title()}
    aria-expanded={!collapsed}
    aria-controls="combined-panel-chief-content"
    data-chief-section-toggle
    onclick={ontoggle}
  ></button>
  <div id="combined-panel-chief-content" hidden={collapsed}></div>
{:else}
  <div data-testid="mock-card-content" data-expanded={expanded}></div>
{/if}
