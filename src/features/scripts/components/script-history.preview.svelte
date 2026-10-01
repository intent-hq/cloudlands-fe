<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ state: string }>({
    id: 'script-history',
    title: 'Script history and cleanup',
    defaultState: 'large',
    states: Object.fromEntries(
      ['large', 'empty', 'loading', 'error'].map((state) => [state, { props: { state } }]),
    ),
  });
</script>

<script lang="ts">
  import ScriptHistoryView from './ScriptHistoryView.svelte';
  import { makeScriptHistoryFixture } from './script-history-fixture';
  import { canArchiveScript } from '../utils/script-history';
  let { state: sceneState = 'large' }: { state?: string } = $props();
  let scripts = $state(
    makeScriptHistoryFixture().map((s, i) =>
      i < 3
        ? {
            ...s,
            archivedAt: '2026-09-30T12:00:00Z',
            lastRun: {
              outcome:
                i === 0
                  ? ('failed' as const)
                  : i === 1
                    ? ('interrupted' as const)
                    : ('cancelled' as const),
              stoppedAt: '2026-09-30T12:00:00Z',
              exitCode: i === 0 ? 2 : -1,
              error: i === 0 ? 'Synthetic test assertion failed' : 'Synthetic interrupted command',
            },
          }
        : s,
    ),
  );
  let inspected = $state('');
</script>

<div class="p-4 w-full max-w-3xl">
  <ScriptHistoryView
    scripts={sceneState === 'empty' ? [] : scripts}
    loading={sceneState === 'loading'}
    error={sceneState === 'error' ? 'Synthetic load error' : undefined}
    onRetry={() => {}}
    onInspect={(id) => (inspected = id)}
    onSubmit={(ids, operation) =>
      (scripts = scripts.map((s) =>
        ids.includes(s.id)
          ? operation === 'restore'
            ? { ...s, archivedAt: undefined }
            : canArchiveScript(s)
              ? { ...s, archivedAt: '2026-09-30T14:00:00Z' }
              : s
          : s,
      ))}
  />
  {#if inspected}<output>{inspected}</output>{/if}
</div>
