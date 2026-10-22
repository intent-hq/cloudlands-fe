<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'bulk-delete-dialog',
    title: 'Bulk delete dialog',
    defaultState: 'archived',
    states: { archived: { props: { static: true } } },
  });
</script>

<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { type Workspace, WorkspaceStatusEnum } from '$shared/types';
  import { formatInteger } from '$lib/i18n/format';
  import BulkActionConfirmDialog from './BulkActionConfirmDialog.svelte';
  import BulkWorkspaceList from './BulkWorkspaceList.svelte';

  let {
    static: staticPosition = false,
    preflightReady = true,
    onConfirm = () => {},
    onCancel = () => {},
  }: {
    static?: boolean;
    preflightReady?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
  } = $props();

  const workspaces: Workspace[] = Array.from({ length: 190 }, (_, index) => ({
    id: `bulk-delete-fixture-${index}` as Workspace['id'],
    branch: `fixture/archived-${index}`,
    title:
      index % 2 === 0
        ? `Workspace ${index + 1}: investigate archived workspace cleanup and preserve review history`
        : `workspace-${index + 1}-${'unbroken-title-'.repeat(12)}`,
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Archived,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  }));
</script>

<BulkActionConfirmDialog
  open
  static={staticPosition}
  title={m.modals_bulkDelete_title({ group: 'Archived' })}
  description={m.modals_bulkDelete_description_many({ count: formatInteger(workspaces.length) })}
  confirmText={m.modals_bulkDelete_confirm_label()}
  variant="destructive"
  initialFocus="cancel"
  openPrCount={7}
  {preflightReady}
  {onConfirm}
  {onCancel}
>
  {#snippet body()}
    <BulkWorkspaceList {workspaces} />
  {/snippet}
</BulkActionConfirmDialog>
