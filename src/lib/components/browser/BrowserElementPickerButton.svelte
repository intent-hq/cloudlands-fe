<script lang="ts">
  import { faCrosshairs } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    active: boolean;
    disabled: boolean;
    onToggle: () => void;
  }

  let { active, disabled, onToggle }: Props = $props();
</script>

<Button
  variant="ghost-light"
  size="icon-xs"
  class={active ? 'bg-muted text-foreground' : ''}
  onclick={onToggle}
  {disabled}
  tooltip={active
    ? m.browser_embedded_cancelElementSelection_tooltip()
    : m.browser_embedded_selectElement_tooltip()}
  tooltipSide="bottom"
  aria-label={active
    ? m.browser_embedded_cancelElementSelection_ariaLabel()
    : m.browser_embedded_selectElement_ariaLabel()}
  aria-pressed={active}
  data-testid="browser-select-element"
>
  <Fa icon={faCrosshairs} size="xs" />
</Button>
