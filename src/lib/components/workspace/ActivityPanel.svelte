<script lang="ts">
  /**
   * ActivityPanel - Full activity log view for the main content area
   *
   * A thin wrapper around ActivityTimeline that adds a PanelWrapper with header.
   */
  import ActivityTimeline from '$features/log/components/ActivityTimeline.svelte';
  import PanelWrapper from '$lib/components/ui/PanelWrapper.svelte';
  import { faTimeline } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    workspaceId: string;
    onClose?: () => void;
    handleFileSelect?: (path: string) => void;
    onShowAgent?: (agentId: string) => void;
    class?: string;
  }

  let { workspaceId, onClose, handleFileSelect, onShowAgent, class: className }: Props = $props();
</script>

<PanelWrapper
  title="Activity"
  faIcon={faTimeline}
  showClose={!!onClose}
  {onClose}
  class={className}
  contentClass="flex flex-col overflow-hidden"
>
  <ActivityTimeline {workspaceId} {handleFileSelect} {onShowAgent} />
</PanelWrapper>
