<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store as appStore } from '$store/renderer/store';
  import {
    bulkUpsertSessions,
    removeSession,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import { AgentStatus } from '$shared/types';
  function setupRemote() {
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: AgentId('preview-remote-media'),
          workspaceId: WorkspaceId('preview-remote-media'),
          backendSessionId: null,
          name: 'Remote builder',
          status: AgentStatus.Halted,
          messages: [],
          createdAt: '2026-09-28T08:00:00Z',
          updatedAt: '2026-09-28T08:00:00Z',
          placement: { target: 'remote', checkout: 'isolated' },
          nodeState: 'offline',
        },
      ]),
    );
    return () => appStore.dispatch(removeSession('preview-remote-media'));
  }
  export const preview = definePreview({
    id: 'remote-agent-media',
    title: 'Remote agent media',
    defaultState: 'offline',
    states: { offline: { props: {}, setup: setupRemote } },
  });
</script>

<script lang="ts">
  import type { ContentBlock } from '$shared/types/content-block';
  import MessageContent from './MessageContent.svelte';
  import StreamingMessageContent from './StreamingMessageContent.svelte';
  const content: ContentBlock[] = [
    {
      type: 'text',
      text: 'Remote build output.\n\n![Build screenshot](intent://local/file/output.png)\n\n![Build recording](intent://local/file/output.mp4)',
    },
  ];
</script>

<div class="max-w-2xl space-y-6 p-4">
  <section class="space-y-2">
    <h2 class="type-body font-semibold">Remote build output</h2>
    <MessageContent agentId="preview-remote-media" workspaceId="preview-remote-media" {content} />
  </section>
  <section class="space-y-2">
    <h2 class="type-body font-semibold">Streaming output</h2>
    <StreamingMessageContent
      agentId="preview-remote-media"
      workspaceId="preview-remote-media"
      {content}
      isStreaming
    />
  </section>
</div>
