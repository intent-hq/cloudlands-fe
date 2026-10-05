<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview({
    id: 'specialist-workspace',
    title: 'Project specialist settings',
    defaultState: 'project',
    states: { project: { props: {} } },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import AIBehaviorSidebar from './AIBehaviorSidebar.svelte';
  import AIBehaviorEditor from './AIBehaviorEditor.svelte';
  import type { SpecialistDef } from '$lib/client/app-client';
  import { setupWorkspaceSpecialists } from './__tests__/specialist-workspace.fixture';
  let {
    launchError = '',
    definition,
    locality = 'local',
  }: { launchError?: string; definition?: SpecialistDef; locality?: 'local' | 'remote' } = $props();
  const specialistId = $derived(definition?.id ?? 'shared');
  let workspaceId = $state<string | undefined>('project-a');
  let values = $state<Record<string, string>>({});
  const fixture = setupWorkspaceSpecialists(
    (key, value) => {
      values = { ...values, [key]: value };
    },
    launchError,
    definition,
  );
  async function change(id?: string) {
    workspaceId = id;
    await fixture.load(id);
  }
  $effect(() => fixture.setLocality(locality));
  void fixture.load(workspaceId);
  onDestroy(fixture.dispose);
</script>

<div class="p-6">
  <!-- i18n-ignore (preview-only controls) -->
  <Button data-testid="switch-b" onclick={() => change('project-b')}>Project B</Button>
  <!-- i18n-ignore (preview-only controls) -->
  <Button data-testid="switch-global" onclick={() => change()}>Global</Button>
  <!-- i18n-ignore (preview-only controls) -->
  <Button data-testid="fail-refresh" onclick={() => fixture.load(workspaceId, 'fail')}
    >Fail refresh</Button
  >
  <!-- i18n-ignore (preview-only controls) -->
  <Button data-testid="empty-refresh" onclick={() => fixture.load(workspaceId, 'empty')}
    >Empty refresh</Button
  >
  <!-- i18n-ignore (preview-only controls) -->
  <Button data-testid="launch" onclick={fixture.launch}>Launch</Button>
  <AIBehaviorSidebar
    {workspaceId}
    activeView={{ type: 'specialist', id: specialistId }}
    onSelect={() => {}}
  />
  <div data-editor>
    <AIBehaviorEditor
      workspaceId={workspaceId ? WorkspaceId(workspaceId) : null}
      activeView={{ type: 'specialist', id: specialistId }}
    />
  </div>
  {#each Object.entries(values) as [key, value] (key)}<output
      data-testid={key}
      class={key === 'feedback' ? 'mt-4' : 'sr-only'}>{value}</output
    >{/each}
</div>
