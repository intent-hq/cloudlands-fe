<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { tick } from 'svelte';
  import {
    installSummaryFixture,
    previewWorkspaceId,
    type SummaryScene,
  } from './repository-context-summary.preview-fixtures';

  /** Own the controlled boundary and simulated opening only for this preview instance. */
  function mountScene(frame: HTMLDivElement, scene: SummaryScene, initiallyOpen: boolean) {
    const fixture = installSummaryFixture(scene);
    let active = true;
    void tick().then(() => {
      if (active && initiallyOpen)
        frame.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click();
    });
    return {
      ...fixture,
      dispose() {
        active = false;
        fixture.dispose();
      },
    };
  }

  interface Props {
    scene?: SummaryScene;
    initiallyOpen?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'repository-context-summary',
    title: 'Repository details',
    defaultState: 'self-managed',
    states: {
      closed: { props: { scene: 'self-managed', initiallyOpen: false } },
      'self-managed': { props: { scene: 'self-managed', initiallyOpen: true } },
      github: { props: { scene: 'github', initiallyOpen: true } },
      unknown: { props: { scene: 'unknown', initiallyOpen: true } },
      history: { props: { scene: 'history', initiallyOpen: true } },
      'missing-remote': { props: { scene: 'missing-remote', initiallyOpen: true } },
      'selection-required': { props: { scene: 'selection-required', initiallyOpen: true } },
      'no-remote': { props: { scene: 'no-remote', initiallyOpen: true } },
      migrated: { props: { scene: 'migrated', initiallyOpen: true } },
      inactive: { props: { scene: 'inactive', initiallyOpen: true } },
      unavailable: { props: { scene: 'unavailable', initiallyOpen: true } },
      loading: { props: { scene: 'loading', initiallyOpen: true } },
      long: { props: { scene: 'long', initiallyOpen: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import RepositoryContextSummary from './RepositoryContextSummary.svelte';
  import type { RepositoryRootIdentity } from '$shared/types/repository-context';

  let { scene = 'self-managed', initiallyOpen = false }: Props = $props();
  let frame: HTMLDivElement;
  let root = $state<RepositoryRootIdentity>({ workspaceId: previewWorkspaceId, kind: 'primary' });
  let fixture: ReturnType<typeof mountScene>;
  onMount(() => {
    fixture = mountScene(frame, scene, initiallyOpen);
    return () => fixture.dispose();
  });
</script>

<div bind:this={frame} class="w-full min-w-0 bg-background text-foreground">
  <div class="flex flex-wrap gap-1 p-2" aria-label="Preview controls">
    <Button
      variant="ghost"
      size="compact"
      onclick={() => (root = { workspaceId: previewWorkspaceId, kind: 'primary' })}
      >Primary root</Button
    >
    <Button
      variant="ghost"
      size="compact"
      onclick={() =>
        (root = { workspaceId: previewWorkspaceId, kind: 'registered', gitRootId: 'tools' })}
      >Tools root</Button
    >
    <Button
      variant="ghost"
      size="compact"
      onclick={() =>
        (root = { workspaceId: previewWorkspaceId, kind: 'registered', gitRootId: 'missing' })}
      >Missing root</Button
    >
    <Button variant="ghost" size="compact" onclick={() => fixture.retire()}>Retire read</Button>
    <Button variant="ghost" size="compact" onclick={() => fixture.admit('local-B')}
      >Replace host</Button
    >
  </div>
  <RepositoryContextSummary {root} />
</div>
