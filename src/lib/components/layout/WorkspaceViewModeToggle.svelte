<script lang="ts">
  import IntentNavigationIcon from '$lib/icons/IntentNavigationIcon.svelte';
  import { Toggle } from '$lib/components/ui/toggle';
  import { selectWorkspaceViewMode } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { setWorkspaceViewModeWithTransition } from '$features/workspace/workspace-view-mode-action';
  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import {
    TITLEBAR_NAVIGATION_CONTROL_CLASS,
    TITLEBAR_NAVIGATION_GLYPH_CLASS,
  } from './titlebar-navigation';
  import TitlebarNavigationTooltip from './TitlebarNavigationTooltip.svelte';

  const viewMode$ = selectWorkspaceViewMode();
  const isColumns = $derived($viewMode$ === 'columns');
  const toggleLabel = $derived(
    isColumns
      ? m.layout_workspaceTabStrip_openSpaces_ariaLabel()
      : m.workspace_columns_openSpaces_ariaLabel(),
  );

  function handleChange(pressed: string | boolean) {
    const nextMode = pressed === true ? 'columns' : 'single';
    void setWorkspaceViewModeWithTransition(nextMode);
  }
</script>

<TitlebarNavigationTooltip label={toggleLabel} shortcut="mod+shift+l">
  <Toggle
    pressed={isColumns}
    onChange={handleChange}
    size="xs"
    class={cn(
      'app-no-drag size-8 shrink-0 border-0 p-0 data-[state=on]:text-foreground!',
      TITLEBAR_NAVIGATION_CONTROL_CLASS,
    )}
    ariaLabel={toggleLabel}
  >
    <span class={TITLEBAR_NAVIGATION_GLYPH_CLASS} data-titlebar-navigation-glyph>
      <IntentNavigationIcon
        name={isColumns ? 'tabs' : 'spaces'}
        size={16}
        class="pointer-events-none size-4!"
      />
    </span>
  </Toggle>
</TitlebarNavigationTooltip>
