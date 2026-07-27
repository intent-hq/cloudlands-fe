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
  import { m } from '$shared/paraglide/messages.js';

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
    toast.success(m.chat_diffViewer_applied_toast());
  }

  function handleReject() {
    onReject?.();
    toast.info(m.chat_diffViewer_rejected_toast());
  }

  // Build actions array for PureDiff
  const actions = $derived.by((): DiffAction[] => {
    const result: DiffAction[] = [];
    if (onApply) {
      result.push({
        label: m.chat_diffViewer_apply_label(),
        variant: 'success',
        onClick: handleApply,
      });
    }
    if (onReject) {
      result.push({
        label: m.chat_diffViewer_reject_label(),
        variant: 'danger',
        onClick: handleReject,
      });
    }
    return result;
  });
</script>

<DiffViewer
  patch={diff}
  fileName={filePath || m.chat_diffViewer_suggestedChanges_fallback()}
  {language}
  {actions}
  collapsible={true}
  initialCollapsed={false}
  maxHeight="500px"
/>
