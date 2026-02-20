<!--
  Activity Log Component

  Sleek, Vercel-inspired activity timeline with vertical connectors,
  natural language descriptions, inline entity chips, and agent avatars.
-->

<script lang="ts">
  import ActivityTimeline from './components/ActivityTimeline.svelte';

  interface Props {
    workspaceId: string;
    handleFileSelect?: (path: string) => void;
    onShowAgent?: (agentId: string, event?: MouseEvent) => void;
    onOpenNote?: (noteId: string, event?: MouseEvent) => void;
  }

  let { workspaceId, handleFileSelect, onShowAgent, onOpenNote }: Props = $props();
</script>

<ActivityTimeline {workspaceId} {handleFileSelect} {onShowAgent} {onOpenNote} />
