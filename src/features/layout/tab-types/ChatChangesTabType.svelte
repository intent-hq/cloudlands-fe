<script lang="ts">
  /**
   * Chat Changes Tab Type Component
   *
   * Shows file changes from an agent turn or chat interaction.
   */

  import type { TabTypeComponentProps } from './registry';
  import { m } from '$shared/paraglide/messages.js';
  import ChatChangesPanel from '$lib/components/chat/ChatChangesPanel.svelte';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { writable } from 'svelte/store';

  let { tab, workspaceId }: TabTypeComponentProps = $props();

  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const workspace = selectWorkspaceById(workspaceIdStore);
  const workspacePath = $derived($workspace?.worktreePath || $workspace?.repositoryPath || '');

  // Get changes data from tab
  const chatChanges = $derived((tab.data?.changes as any[]) || []);
  const isAggregate = $derived((tab.data?.isAggregate as boolean) || false);
  const agentId = $derived(tab.data?.agentId as string | undefined);

  // Normalize file paths
  const normalizedChanges = $derived(
    chatChanges.map((c: any) => {
      const filePath = c.filePath?.startsWith('/') ? c.filePath : `${workspacePath}/${c.filePath}`;
      return { ...c, filePath };
    }),
  );
</script>

{#if chatChanges.length > 0}
  <ChatChangesPanel
    isLoading={false}
    changes={normalizedChanges}
    {isAggregate}
    {agentId}
    showStagingControls={true}
  />
{:else}
  <div class="flex flex-col items-center justify-center h-full text-subtle gap-4">
    <p class="text-sm">{m.layout_chatChanges_noChanges_label()}</p>
  </div>
{/if}
