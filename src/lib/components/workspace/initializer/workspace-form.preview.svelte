<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupWorkspaceFormPreview } from './workspace-form.preview-fixtures';

  interface Props {
    scenario?: 'default' | 'long' | 'empty' | 'config-error' | 'orchestration' | 'many-repos';
    modal?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'workspace-form',
    title: 'New workspace form',
    defaultState: 'default',
    captureReadiness: { selector: '[data-workspace-form-ready=true]' },
    states: {
      default: { props: {}, setup: () => setupWorkspaceFormPreview('default') },
      long: { props: { scenario: 'long' }, setup: () => setupWorkspaceFormPreview('long') },
      empty: { props: { scenario: 'empty' }, setup: () => setupWorkspaceFormPreview('empty') },
      'config-error': {
        props: { scenario: 'config-error' },
        setup: () => setupWorkspaceFormPreview('config-error'),
      },
      orchestration: {
        props: { scenario: 'orchestration' },
        setup: () => setupWorkspaceFormPreview('orchestration'),
      },
      modal: { props: { modal: true } },
      'modal-long': { props: { modal: true, scenario: 'long' } },
      history: { props: { modal: true, scenario: 'many-repos' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import NewSpaceModal from '$lib/components/modals/NewSpaceModal.svelte';
  import { selectWorkspaceInitializerGitAvailability } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';

  let { scenario = 'default', modal = false }: Props = $props();
  const gitAvailable$ = selectWorkspaceInitializerGitAvailability();
  if (untrack(() => modal)) {
    onDestroy(setupWorkspaceFormPreview(untrack(() => scenario)));
  }
</script>

<div class="w-full min-w-0 p-4" data-workspace-form-ready={$gitAvailable$ === true}>
  <NewSpaceModal open static={!modal} />
</div>
