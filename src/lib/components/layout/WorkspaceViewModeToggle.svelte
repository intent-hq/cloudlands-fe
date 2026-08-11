<script lang="ts">
  import { faColumns } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { tick } from 'svelte';
  import { Toggle } from '$lib/components/ui/toggle';
  import { store as appStore } from '$store/renderer/store';
  import { setWorkspaceViewMode } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { selectWorkspaceViewMode } from '$store/renderer/slices/tab-state/tab-state-selectors';

  const viewMode$ = selectWorkspaceViewMode();
  const isColumns = $derived($viewMode$ === 'columns');

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
  class="app-no-drag size-7 border-0 bg-transparent p-0 shadow-none data-[state=on]:bg-transparent!"
  ariaLabel="Show open spaces as columns"
  title={isColumns ? 'Use tab view' : 'Show open spaces as columns'}
>
  <Fa icon={faColumns} class="size-3.5!" />
</Toggle>
