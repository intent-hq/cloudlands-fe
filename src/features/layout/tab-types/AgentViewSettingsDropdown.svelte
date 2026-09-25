<script lang="ts">
  import Fa from 'svelte-fa';
  import { faSliders } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { selectAgentFontStyle } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    setAgentFontStyle,
    type AgentFontStyle,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  let { embedded = false }: { embedded?: boolean } = $props();
  const fontStyle = selectAgentFontStyle();
  let open = $state(false);

  function setFontStyle(value: string) {
    if (value !== 'sans' && value !== 'monospace') return;
    appStore.dispatch(setAgentFontStyle(value as AgentFontStyle));
  }
</script>

{#snippet fontItems()}
  <Menu.RadioGroup value={$fontStyle} onValueChange={setFontStyle}>
    <Menu.RadioItem value="sans" closeOnSelect={false}>
      {m.settings_fontStyle_sans()}
    </Menu.RadioItem>
    <Menu.RadioItem value="monospace" closeOnSelect={false}>
      {m.settings_fontStyle_mono()}
    </Menu.RadioItem>
  </Menu.RadioGroup>
{/snippet}

{#if embedded}
  <Menu.Label>{m.settings_section_fontStyle()}</Menu.Label>
  <div class="panel-font-options">{@render fontItems()}</div>
{:else}
  <Menu.Root bind:open>
    <Menu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost-light"
          size="icon-xs"
          tooltip={m.ui_viewSettings_trigger_tooltip()}
          tooltipSide="bottom"
          aria-label={m.ui_viewSettings_trigger_tooltip()}
          aria-expanded={open}
          data-testid="agent-view-settings-trigger"
        >
          <Fa icon={faSliders} size="xs" />
        </Button>
      {/snippet}
    </Menu.Trigger>
    <Menu.Content align="end" class="w-56" aria-label={m.settings_section_fontStyle()}>
      {@render fontItems()}
    </Menu.Content>
  </Menu.Root>
{/if}

<style>
  .panel-font-options :global([data-slot='menu-radio-item']) {
    justify-content: flex-start;
    align-items: center;
  }

  .panel-font-options :global([data-slot='menu-item-indicator']) {
    order: -1;
    width: 14px;
    height: 14px;
    margin-inline: 0;
  }
  .panel-font-options :global([data-slot='menu-item-indicator'] svg) {
    display: none;
  }
  .panel-font-options :global([data-state='checked']) {
    background: var(--panel-menu-selected, hsl(var(--accent)));
  }
  .panel-font-options :global([data-state='checked'] [data-slot='menu-item-indicator']::after) {
    content: '';
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: hsl(var(--success));
  }
</style>
