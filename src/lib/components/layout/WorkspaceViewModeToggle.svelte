<script lang="ts">
  import IntentNavigationIcon from '$lib/icons/IntentNavigationIcon.svelte';
  import { tick } from 'svelte';
  import { Toggle } from '$lib/components/ui/toggle';
  import { store as appStore } from '$store/renderer/store';
  import { setWorkspaceViewMode } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { selectWorkspaceViewMode } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import {
    TITLEBAR_NAVIGATION_CONTROL_CLASS,
    TITLEBAR_NAVIGATION_GLYPH_CLASS,
  } from './titlebar-navigation';

  const viewMode$ = selectWorkspaceViewMode();
  const isColumns = $derived($viewMode$ === 'columns');
  const toggleLabel = $derived(
    isColumns
      ? m.layout_workspaceTabStrip_openSpaces_ariaLabel()
      : m.workspace_columns_openSpaces_ariaLabel(),
  );

  function handleChange(pressed: string | boolean) {
    const nextMode = pressed === true ? 'columns' : 'single';
    const update = async () => {
      appStore.dispatch(setWorkspaceViewMode(nextMode));
      await tick();
    };
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const transitionDocument = document as Document & {
      startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> };
    };

    if (!transitionDocument.startViewTransition || reduceMotion) {
      void update();
      return;
    }

    document.documentElement.classList.add('workspace-view-transition');
    const transition = transitionDocument.startViewTransition.call(document, update);
    void transition.finished.finally(() => {
      document.documentElement.classList.remove('workspace-view-transition');
    });
  }
</script>

<Toggle
  pressed={isColumns}
  onChange={handleChange}
  size="xs"
  class={cn(
    'app-no-drag size-8 shrink-0 border-0 p-0 data-[state=on]:text-foreground!',
    TITLEBAR_NAVIGATION_CONTROL_CLASS,
  )}
  ariaLabel={toggleLabel}
  title={toggleLabel}
>
  <span class={TITLEBAR_NAVIGATION_GLYPH_CLASS} data-titlebar-navigation-glyph>
    <IntentNavigationIcon
      name={isColumns ? 'tabs' : 'spaces'}
      size={16}
      class="pointer-events-none size-4!"
    />
  </span>
</Toggle>
