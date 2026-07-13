<script lang="ts">
  /**
   * ChatDiffViewer - Chat message diff viewer
   *
   * A thin wrapper around the canonical DiffViewer for chat messages.
   * Adds apply/reject actions for interactive diff handling.
   */
  import { DiffViewer } from '$lib/components/ui/diff';
  import type { DiffAction } from '$lib/components/ui/diff';
  import { toast } from 'svelte-sonner';

  interface Props {
    diff: string;
    filePath?: string;
    language?: string;
    onApply?: () => void;
    onReject?: () => void;
  }

  let { diff, filePath, language, onApply, onReject }: Props = $props();

  function handleApply() {
    onApply?.();
    toast.success('Diff applied successfully');
  }

  function handleReject() {
    onReject?.();
    toast.info('Diff rejected');
  }

  // Build actions array for PureDiff
  const actions = $derived.by((): DiffAction[] => {
    const result: DiffAction[] = [];
    if (onApply) {
      result.push({
        label: 'Apply',
        variant: 'success',
        onClick: handleApply,
      });
    }
    if (onReject) {
      result.push({
        label: 'Reject',
        variant: 'danger',
        onClick: handleReject,
      });
    }
    return result;
  });
</script>

<DiffViewer
  patch={diff}
  fileName={filePath || 'Suggested Changes'}
  {language}
  {actions}
  collapsible={true}
  initialCollapsed={false}
  maxHeight="500px"
/>
