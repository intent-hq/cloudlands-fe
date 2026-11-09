<script lang="ts">
  import DesktopPermissionMenu from '$features/desktop/renderer/DesktopPermissionMenu.svelte';
  import Fa from 'svelte-fa';
  import { faSliders, faFont } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import {
    faArrowsInLineVertical,
    faArrowsOutLineHorizontal,
    faSparkle,
  } from '$lib/icons/phosphor-icons';
  import * as Menu from '$lib/components/ui/menu';
  import {
    selectAgentFontStyle,
    selectChatContentWidth,
    selectChatAuroraEnabled,
    selectCollapseToolRuns,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    setAgentFontStyle,
    setChatContentWidth,
    setChatAuroraEnabled,
    setCollapseToolRuns,
    type AgentFontStyle,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  let {
    embedded = false,
    workspaceId,
    agentId,
  }: { embedded?: boolean; workspaceId?: string; agentId?: string } = $props();
  const fontStyle = selectAgentFontStyle();
  const chatContentWidth = selectChatContentWidth();
  const chatAuroraEnabled = selectChatAuroraEnabled();
  const collapseToolRuns = selectCollapseToolRuns();
  let open = $state(false);
  const fontLabel = $derived(
    $fontStyle === 'sans' ? m.settings_fontStyle_sans() : m.settings_fontStyle_mono(),
  );

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

{#snippet chatAppearanceItems()}
  <Menu.CheckboxItem
    indicator="switch"
    icon={faArrowsOutLineHorizontal}
    checked={$chatContentWidth === 'full'}
    closeOnSelect={false}
    onCheckedChange={(enabled) => appStore.dispatch(setChatContentWidth(enabled ? 'full' : '800'))}
  >
    {m.settings_appearance_chatContentWidth_label()}
  </Menu.CheckboxItem>
  <Menu.CheckboxItem
    indicator="switch"
    icon={faSparkle}
    checked={$chatAuroraEnabled}
    closeOnSelect={false}
    onCheckedChange={(enabled) => appStore.dispatch(setChatAuroraEnabled(enabled))}
  >
    {m.settings_appearance_chatAurora_label()}
  </Menu.CheckboxItem>
  <Menu.CheckboxItem
    indicator="switch"
    icon={faArrowsInLineVertical}
    checked={$collapseToolRuns}
    closeOnSelect={false}
    onCheckedChange={(enabled) => appStore.dispatch(setCollapseToolRuns(enabled))}
  >
    {m.settings_appearance_collapseToolRuns_label()}
  </Menu.CheckboxItem>
{/snippet}

{#snippet desktopPermission()}
  {#if workspaceId && agentId}
    {#key `${workspaceId}:${agentId}`}
      <DesktopPermissionMenu {workspaceId} {agentId} separator={!embedded} />
    {/key}
  {/if}
{/snippet}

{#if embedded}
  <Menu.Sub>
    <Menu.SubTrigger icon={faFont} iconWeight="regular">
      <span class="min-w-0 flex-1">{m.ui_viewSettings_font_label()}</span>
      <span class="type-caption {Menu.menuDescription}">{fontLabel}</span>
    </Menu.SubTrigger>
    <Menu.SubContent aria-label={m.ui_viewSettings_font_label()}>
      {@render fontItems()}
    </Menu.SubContent>
  </Menu.Sub>
  {@render chatAppearanceItems()}
  {@render desktopPermission()}
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
    <Menu.Content align="end" class="w-56" aria-label={m.ui_viewSettings_trigger_tooltip()}>
      {@render fontItems()}
      <Menu.Separator />
      {@render chatAppearanceItems()}
      {@render desktopPermission()}
    </Menu.Content>
  </Menu.Root>
{/if}
