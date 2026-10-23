<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ scenario: 'banner' | 'collaborator' | 'confirm' }>({
    id: 'retired-workspace',
    title: 'Retired workspace',
    defaultState: 'banner',
    states: {
      banner: { props: { scenario: 'banner' } },
      collaborator: { props: { scenario: 'collaborator' } },
      confirm: { props: { scenario: 'confirm' } },
    },
  });
</script>

<script lang="ts">
  import RetiredWorkspaceBanner from './RetiredWorkspaceBanner.svelte';
  import RetireWorkspaceConfirmDialog from '$lib/components/modals/RetireWorkspaceConfirmDialog.svelte';

  let { scenario = 'banner' }: { scenario?: 'banner' | 'collaborator' | 'confirm' } = $props();
</script>

{#if scenario === 'confirm'}
  <RetireWorkspaceConfirmDialog
    open
    static
    workspaceTitle="Prototype the old importer"
    onConfirm={() => {}}
    onCancel={() => {}}
  />
{:else}
  <div
    class="flex h-[420px] w-full flex-col overflow-hidden rounded-lg border border-border bg-background"
  >
    <RetiredWorkspaceBanner
      workspaceId="preview-retired-workspace"
      canRestore={scenario === 'banner'}
    />
    <div class="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <p class="type-caption text-muted-foreground">Coordinator · conversation kept read-only</p>
      <div class="max-w-[70%] self-end rounded-lg bg-muted px-3 py-2 type-body">
        Prototype a streaming importer for large CSV files.
      </div>
      <div class="max-w-[80%] rounded-lg border border-border px-3 py-2 type-body">
        The prototype parses 2 GB files in 40 s. The rewrite shipped on main, so this workspace can
        be retired.
      </div>
    </div>
  </div>
{/if}
