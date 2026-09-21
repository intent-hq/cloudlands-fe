<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ mode: 'delete' | 'archive' }>({
    id: 'delete-warning-dialog',
    title: 'Workspace delete warning',
    defaultState: 'open-pr',
    states: {
      'open-pr': { props: { mode: 'delete' } },
      archive: { props: { mode: 'archive' } },
    },
  });
</script>

<script lang="ts">
  import DeleteWarningDialog from './DeleteWarningDialog.svelte';

  let { mode = 'delete' }: { mode?: 'delete' | 'archive' } = $props();
</script>

<DeleteWarningDialog
  open
  static
  {mode}
  openPrs={[
    {
      number: 418,
      title: 'Refine workspace warning layout and preserve the full content width',
      status: 'Open',
      url: '',
    },
  ]}
/>
