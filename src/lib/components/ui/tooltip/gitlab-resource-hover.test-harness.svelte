<script lang="ts">
  import { onMount } from 'svelte';
  import { appClient } from '$lib/client';
  import fixture from '$shared/types/__fixtures__/repository-resource-read.json';
  import {
    RepositoryResourceCaptureSchema,
    RepositoryResourceResultSchema,
  } from '$shared/types/repository-resource-read';
  import { createLinkTooltipHandler } from '$features/navigation/link-handler';
  import { hideLinkTooltip } from './link-tooltip-state.svelte';
  let container: HTMLDivElement;
  let mounted = $state(true);
  let requests = $state(0);
  let releases = $state(0);
  const retire = new Set<() => void>();
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Synchronous JSON fixture decoding; this test harness makes no provider request.
  const captureFixture = RepositoryResourceCaptureSchema.parse(fixture.capture);
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Synchronous JSON fixture decoding for controlled browser replies.
  const mrFixture = RepositoryResourceResultSchema.parse(fixture.mergeRequest);
  const mrUrl = fixture.mergeRequest.outcome.snapshot.details.url;
  function control(action: string) {
    if (action === 'Retire connection') {
      for (const listener of [...retire]) listener();
    } else if (action === 'Unmount links') mounted = false;
  }
  onMount(() => {
    const onControl = (event: Event) => control((event as CustomEvent<string>).detail);
    window.addEventListener('resource-hover-control', onControl);
    const original = appClient.integrations.captureRepositoryResource;
    appClient.integrations.captureRepositoryResource = async (workspaceId) => {
      if (workspaceId !== 'workspace-A') throw new Error('Unexpected workspace');
      let released = false;
      let listener: (() => void) | undefined;
      return {
        capture: captureFixture,
        onRetired: (handler) => {
          listener = handler;
          retire.add(handler);
          return () => retire.delete(handler);
        },
        detail: async () => {
          requests++;
          return mrFixture;
        },
        release: async () => {
          if (!released) {
            released = true;
            releases++;
            if (listener) retire.delete(listener);
          }
        },
      };
    };
    const stopHover = createLinkTooltipHandler(container);
    return () => {
      window.removeEventListener('resource-hover-control', onControl);
      stopHover();
      hideLinkTooltip();
      appClient.integrations.captureRepositoryResource = original;
    };
  });
</script>

<div
  bind:this={container}
  class="grid gap-8 p-12"
  data-workspace-surface="workspace-A"
  data-testid="hover-control"
  data-requests={requests}
  data-releases={releases}
>
  {#if mounted}
    <section class="grid gap-2" aria-label="Chat">
      <a data-testid="mr-link" href={mrUrl + '/diffs?view=parallel#note_42'}
        >Merge request in chat</a
      >
    </section>
    <section class="grid gap-2" aria-label="Note">
      <a
        data-testid="foreign-link"
        href={mrUrl.replace('gitlab.example.test', 'foreign.example.test')}>Unconfigured host</a
      >
    </section>
  {/if}
</div>
