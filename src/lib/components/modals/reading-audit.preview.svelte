<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ state: string }>({
    id: 'reading-audit',
    title: 'Reading and tools modal audit',
    defaultState: 'release',
    states: Object.fromEntries(
      [
        'release',
        'release-long',
        'release-loading',
        'release-unavailable',
        'release-empty',
        'features-empty',
        'features-active',
        'features-long',
        'shortcuts-global',
        'shortcuts-chat',
        'context-browser',
        'context-github',
        'context-internal',
      ].map((state) => [state, { props: { state } }]),
    ),
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import ReleaseNotesModal from './ReleaseNotesModal.svelte';
  import FeatureCodeDialog from './FeatureCodeDialog.svelte';
  import KeyboardShortcutsCheatSheet from '../layout/KeyboardShortcutsCheatSheet.svelte';
  import ContextPickerModal from '../workspace/sidebar/context-picker/ContextPickerModal.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    openCheatSheet,
    closeCheatSheet,
  } from '$store/renderer/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice';

  let { state = 'release' }: { state?: string } = $props();
  onMount(() => {
    if (!state.startsWith('shortcuts-')) return;
    const previous = appStore.state.shortcutsCheatSheet;
    appStore.dispatch(openCheatSheet(state === 'shortcuts-chat' ? 'chat' : 'global'));
    return () =>
      appStore.dispatch(previous.isOpen ? openCheatSheet(previous.context) : closeCheatSheet());
  });

  const notes = $derived(
    state === 'release-empty'
      ? ''
      : [
          '## Improvements',
          '- Clearer workspace names when quitting.',
          '- Consistent dialogs and keyboard navigation.',
          ...(state === 'release-long'
            ? Array.from(
                { length: 15 },
                (_, index) =>
                  `### Update ${index + 1}\n\n- Long release details remain scrollable without moving the close action.\n- Improved accessibility and error recovery.`,
              )
            : []),
        ].join('\n\n'),
  );
</script>

{#if state.startsWith('release')}
  <ReleaseNotesModal
    open
    loading={state === 'release-loading'}
    releaseNotes={['release-loading', 'release-unavailable'].includes(state)
      ? null
      : {
          version: 'preview',
          notes,
          url: 'https://github.com/intent-hq/cloudlands-releases',
        }}
  />
{:else if state.startsWith('features-')}
  <FeatureCodeDialog
    open
    staticData={{
      activeFeatures:
        state === 'features-empty'
          ? []
          : state === 'features-long'
            ? Array.from(
                { length: 18 },
                (_, index) => `preview-feature-with-a-long-name-${index + 1}`,
              )
            : ['preview-feature'],
    }}
  />
{:else if state.startsWith('shortcuts-')}
  <KeyboardShortcutsCheatSheet />
{:else}
  <ContextPickerModal
    isOpen
    workspaceId="reading-audit"
    provider={state === 'context-browser'
      ? 'browser'
      : state === 'context-github'
        ? 'github'
        : 'internal'}
    onClose={() => {}}
    onSelect={() => {}}
  />
{/if}
