<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCheck, faFont, faSliders } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
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
  const fontOptionClass =
    'relative h-auto min-w-0 flex-col gap-1 rounded-md border border-border bg-transparent px-2 pb-2.5 pt-3 font-normal text-muted-foreground shadow-none hover:border-input hover:bg-transparent hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-transparent data-[state=on]:text-foreground data-[state=on]:shadow-none';

  function setFontStyle(value: string) {
    if (value !== 'sans' && value !== 'monospace') return;
    appStore.dispatch(setAgentFontStyle(value as AgentFontStyle));
  }
</script>

{#if embedded}
  <div
    role="group"
    aria-label={m.settings_section_fontStyle()}
    data-menu-stacked-content="font-style"
  >
    <div
      class="type-caption flex items-center gap-2 px-2 pb-1 pt-1.5 font-medium text-muted-foreground"
    >
      <Fa icon={faFont} size="xs" class="w-4 opacity-70" />
      <span>{m.settings_section_fontStyle()}</span>
    </div>
    <Menu.RadioGroup value={$fontStyle} onValueChange={setFontStyle}>
      <Menu.RadioItem value="sans" closeOnSelect={false}>
        {m.settings_fontStyle_sans()}
      </Menu.RadioItem>
      <Menu.RadioItem value="monospace" closeOnSelect={false}>
        {m.settings_fontStyle_mono()}
      </Menu.RadioItem>
    </Menu.RadioGroup>
  </div>
  <Menu.Separator />
{:else}
  <Menu.Root bind:open>
    <Menu.Trigger>
      {#snippet child({ props })}
        <span class="contents" {...props}>
          <Button
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
        </span>
      {/snippet}
    </Menu.Trigger>
    <Menu.Content align="end" class="w-56 p-3!" aria-label={m.ui_dropdownMenu_ariaLabel()}>
      <section aria-label={m.settings_section_fontStyle()}>
        <ToggleGroup.Root
          type="single"
          value={$fontStyle}
          onValueChange={setFontStyle}
          variant="outline"
          size="sm"
          class="grid w-full grid-cols-2 gap-2 border-0 bg-transparent p-0"
        >
          <ToggleGroup.Item value="sans" class={fontOptionClass}>
            {#if $fontStyle === 'sans'}
              <Fa icon={faCheck} size="xs" class="absolute right-1.5 top-1.5 text-primary" />
            {/if}
            <span class="type-title font-normal leading-none"
              >{m.layout_agentTab_fontSample_label()}</span
            >
            <span class="type-caption font-normal">{m.settings_fontStyle_sans()}</span>
          </ToggleGroup.Item>
          <ToggleGroup.Item value="monospace" class={fontOptionClass}>
            {#if $fontStyle === 'monospace'}
              <Fa icon={faCheck} size="xs" class="absolute right-1.5 top-1.5 text-primary" />
            {/if}
            <span class="type-title font-mono font-normal leading-none"
              >{m.layout_agentTab_fontSample_label()}</span
            >
            <span class="type-caption font-normal">{m.settings_fontStyle_mono()}</span>
          </ToggleGroup.Item>
        </ToggleGroup.Root>
      </section>
    </Menu.Content>
  </Menu.Root>
{/if}
