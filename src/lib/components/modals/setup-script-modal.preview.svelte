<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ generator?: boolean }>({
    id: 'setup-script-modal',
    title: 'Setup script modal',
    defaultState: 'repo-script',
    states: {
      'repo-script': { props: {} },
      generator: { props: { generator: true } },
    },
  });
</script>

<script lang="ts">
  import SetupScriptModal from './SetupScriptModal.svelte';
  import { Button } from '$lib/components/ui/button';
  import { onMount } from 'svelte';
  import { appClient } from '$lib/client';
  import { store as appStore } from '$store/renderer/store';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
  import { WorkspaceStatus, type Workspace } from '$shared/types';

  let { generator = false }: { generator?: boolean } = $props();

  const fixtureScript =
    '# Fixture only: this editor never executes scripts.\n' +
    'printf "%s\\n" "A deliberately long setup message that remains readable when the editor is narrow and word wrapping is enabled."\n';
  let open = $state(true);
  let value = $state(fixtureScript);
  let generatorReady = $state(false);
  let generationCalls = $state(0);

  onMount(() => {
    if (!generator) return;
    const previousWorkspaces = selectWorkspaceItems.select(appStore.state);
    const previousGenerate = appClient.setupScripts.generate;
    appStore.dispatch(
      replaceWorkspaceList([
        {
          id: 'preview-setup-script' as Workspace['id'],
          title: 'Setup script fixture',
          branch: 'preview',
          changesets: [],
          timeline: [],
          conversationInfo: [],
          status: WorkspaceStatus.Active,
          createdAt: '2026-09-16T12:00:00Z',
          updatedAt: '2026-09-16T12:00:00Z',
          path: '/fixture/setup-script',
          repositoryPath: '/fixture/setup-script',
        },
      ]),
    );
    appClient.setupScripts.generate = async () => {
      generationCalls += 1;
      return {
        script: '# Fixture generated draft; never executed.\nprintf "fixture draft\\n"\n',
        projectType: 'node',
        updatedAt: 1789560000000,
        generatedBy: 'agent',
      };
    };
    generatorReady = true;
    return () => {
      appClient.setupScripts.generate = previousGenerate;
      appStore.dispatch(replaceWorkspaceList(previousWorkspaces));
    };
  });
</script>

<div class="min-h-96 p-4">
  <Button onclick={() => (open = true)}>Open setup script</Button>
  <output data-testid="saved-script" class="sr-only">{value}</output>
  <output data-testid="generation-calls" class="sr-only">{generationCalls}</output>
  <SetupScriptModal
    bind:open
    bind:value
    repoPath={generatorReady ? '/fixture/setup-script' : ''}
    repoConfigScript={fixtureScript}
    scriptName="Repo config"
    scriptNameSource="repo-config"
    projectType="node-pnpm"
  />
</div>
