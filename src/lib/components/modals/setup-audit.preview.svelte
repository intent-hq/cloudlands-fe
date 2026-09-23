<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ state: string }>({
    id: 'setup-audit',
    title: 'Setup and directory modal audit',
    defaultState: 'remote-empty',
    states: Object.fromEntries(
      [
        'remote-empty',
        'remote-filled',
        'remote-key',
        'remote-password',
        'remote-websocket',
        'prompt',
        'prompt-long',
        'directory',
        'directory-empty',
        'directory-long',
        'directory-search-empty',
        'directory-loading',
        'directory-error',
        'directory-path-error',
        'file',
      ].map((state) => [state, { props: { state } }]),
    ),
  });
</script>

<script lang="ts">
  import AddRemoteSetupModal from '../workspace/initializer/AddRemoteSetupModal.svelte';
  import SetupPromptDialog from './SetupPromptDialog.svelte';
  import DirectoryPickerModal from '$features/onboarding/messages/DirectoryPickerModal.svelte';
  import DirectoryPickerView from '$features/onboarding/messages/DirectoryPickerView.svelte';
  let { state = 'remote-empty' }: { state?: string } = $props();
  const path = $derived(
    state === 'directory-long'
      ? '/fixture/projects/a-very-long-repository-name/packages/a-very-long-component-name'
      : '/fixture/projects',
  );
</script>

{#if state.startsWith('remote-')}
  <AddRemoteSetupModal
    isOpen
    onclose={() => {}}
    onsave={() => {}}
    initialSetup={state === 'remote-empty'
      ? undefined
      : {
          name: 'Team development server',
          host: 'dev.example.com',
          port: 22,
          username: 'developer',
          workspacePath: '/srv/projects/design-system',
          branch: 'main',
        }}
  />
{:else if state.startsWith('prompt')}
  <SetupPromptDialog
    staticData={{
      backendLabel:
        state === 'prompt-long'
          ? 'A remote team development server with a very long descriptive label'
          : 'Team server',
    }}
  />
{:else if ['directory-loading', 'directory-error', 'directory-path-error'].includes(state)}
  <DirectoryPickerView
    open
    listing={{ path, parent: '/fixture', home: '/fixture', entries: [] }}
    loading={state === 'directory-loading'}
    error={state === 'directory-error' ? 'Permission denied while reading this directory.' : null}
    pathError={state === 'directory-path-error' ? 'The requested directory does not exist.' : null}
    onSelect={() => {}}
    onClose={() => {}}
    onNavigate={() => {}}
    onNavigateToPath={() => {}}
    onClearPathError={() => {}}
  />
{:else}
  <DirectoryPickerModal
    open
    mode={state === 'file' ? 'file' : 'directory'}
    onSelect={() => {}}
    onClose={() => {}}
    staticData={{
      listing: {
        path,
        parent: '/fixture',
        home: '/fixture',
        entries:
          state === 'directory-empty'
            ? []
            : Array.from({ length: state === 'directory-long' ? 30 : 5 }, (_, index) => ({
                name:
                  state === 'directory-long'
                    ? `a-very-long-project-directory-name-${index + 1}`
                    : state === 'file'
                      ? `report-${index + 1}.txt`
                      : `project-${index + 1}`,
                path: `${path}/entry-${index}`,
                isDirectory: state !== 'file',
                isGitRepo: state !== 'file' && index === 0,
              })),
      },
    }}
  />
{/if}
