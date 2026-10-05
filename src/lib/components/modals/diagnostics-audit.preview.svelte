<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ state: string }>({
    id: 'diagnostics-audit',
    title: 'Diagnostic and specialized modal audit',
    defaultState: 'memory',
    states: Object.fromEntries(
      [
        'memory',
        'memory-loading',
        'memory-empty',
        'memory-error',
        'memory-stale',
        'memory-long',
        'memory-expanded',
        'new-workspace',
        'media',
        'media-long',
      ].map((state) => [state, { props: { state } }]),
    ),
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import AgentMemoryBreakdownDialog from '../layout/AgentMemoryBreakdownDialog.svelte';
  import NewSpaceModal from './NewSpaceModal.svelte';
  import MediaLightbox from '$lib/components/ui/MediaLightbox.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    agentMemoryUsageRequested,
    agentMemoryUsageSucceeded,
    agentMemoryUsageFailed,
    agentMemoryBreakdownClosed,
  } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import type { AgentMemoryUsageWirePayload } from '$store/renderer/slices/daemon-health/daemon-health-types';
  let { state = 'memory' }: { state?: string } = $props();
  onMount(() => {
    if (!state.startsWith('memory')) return;
    appStore.dispatch(agentMemoryBreakdownClosed());
    appStore.dispatch(agentMemoryUsageRequested());
    if (state === 'memory-error') appStore.dispatch(agentMemoryUsageFailed());
    else if (state !== 'memory-loading') {
      const agents: AgentMemoryUsageWirePayload['agents'] =
        state === 'memory-empty'
          ? []
          : Array.from({ length: state === 'memory-long' ? 18 : 2 }, (_, index) => ({
              agentId: `agent-${index}`,
              agentName: `Design reviewer ${index + 1}`,
              workspaceId:
                state === 'memory-long'
                  ? 'workspace-with-a-very-long-identifier-for-overflow'
                  : 'design-system',
              provider: 'codex',
              model: 'preview',
              rootPid: 100 + index,
              processCount: 1,
              memoryBytes: 128 * 1024 * 1024,
              processes: [
                {
                  pid: 100 + index,
                  parentPid: 1,
                  name: 'node',
                  cmdline:
                    '/fixture/runtime/node /fixture/agents/design-review/index.mjs --workspace design-system',
                  memoryBytes: 128 * 1024 * 1024,
                },
              ],
            }));
      appStore.dispatch(
        agentMemoryUsageSucceeded({
          sampledAt: '2026-09-22T00:00:00Z',
          totalBytes: agents.length * 128 * 1024 * 1024,
          agents,
        }),
      );
      if (state === 'memory-stale') {
        appStore.dispatch(agentMemoryUsageRequested());
        appStore.dispatch(agentMemoryUsageFailed());
      }
    }
    return () => appStore.dispatch(agentMemoryBreakdownClosed());
  });
  const sampleImage =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#eee"/><rect x="80" y="70" width="640" height="360" rx="24" fill="#555"/></svg>',
    );
</script>

{#if state.startsWith('memory')}
  <AgentMemoryBreakdownDialog onClose={() => {}} />
{:else if state === 'new-workspace'}
  <NewSpaceModal open />
{:else}
  <MediaLightbox
    open
    ariaLabel="Audit media preview"
    closeLabel="Close preview"
    caption={state === 'media-long'
      ? 'A long attachment caption that should remain readable without covering the image or hiding the close action on a narrow screen.'
      : 'Workspace screenshot'}
  >
    <img
      src={sampleImage}
      alt="Neutral geometry fixture"
      class="max-h-full max-w-full object-contain"
    />
  </MediaLightbox>
{/if}
