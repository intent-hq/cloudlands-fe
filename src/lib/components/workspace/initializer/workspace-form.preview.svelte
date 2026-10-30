<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    scenario?: 'default' | 'long' | 'empty' | 'config-error' | 'orchestration';
    modal?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'workspace-form',
    title: 'New workspace form',
    defaultState: 'default',
    captureReadiness: { selector: '[data-workspace-form-ready=true]' },
    states: {
      default: { props: {} },
      long: { props: { scenario: 'long' } },
      empty: { props: { scenario: 'empty' } },
      'config-error': { props: { scenario: 'config-error' } },
      orchestration: { props: { scenario: 'orchestration' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import NewSpaceModal from '$lib/components/modals/NewSpaceModal.svelte';
  import { setupWorkspaceFormPreview } from './workspace-form.preview-fixtures';
  import { selectWorkspaceInitializerGitAvailability } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';

  let { scenario = 'default', modal = false }: Props = $props();
  const gitAvailable$ = selectWorkspaceInitializerGitAvailability();
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Preview-only setup installs mock sources and production sagas; it performs no live data reads.
  onDestroy(setupWorkspaceFormPreview(untrack(() => scenario)));
</script>

<div class="w-full min-w-0 p-4" data-workspace-form-ready={$gitAvailable$ === true}>
  <NewSpaceModal open static={!modal} />
</div>
