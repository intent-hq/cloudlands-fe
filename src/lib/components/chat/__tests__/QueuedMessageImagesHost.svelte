<script lang="ts">
  import { onDestroy, setContext, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { WORKSPACE_ROUTE_CONTEXT } from '$lib/utils/workspace-route-context';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import type { QueuedMessage } from '$shared/types';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import QueuedMessageList from '../QueuedMessageList.svelte';
  import { StreamingStore } from '@themislib/themis/streaming-store';
  import { admitPendingSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-admission';
  import { projectPendingSubmissions } from '$store/renderer/slices/pending-submissions/pending-submissions-projection';
  import {
    pendingSubmissionsReducer,
    pendingScopeActivated,
    pendingSubmissionSettled,
    pendingReadStarted,
    pendingReadCompleted,
  } from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
  import type {
    SubmissionInput,
    SubmissionScope,
  } from '$store/renderer/slices/pending-submissions/pending-submissions-types';

  let {
    messages: incoming,
    lookupFails = false,
    projectSubmissions = false,
  }: { messages: QueuedMessage[]; lookupFails?: boolean; projectSubmissions?: boolean } = $props();
  let messages = $state<QueuedMessage[]>([]);
  let requests = $state<{ attachmentId: string; workspaceId: string }[]>([]);
  let sent = $state<QueuedMessage | null>(null);
  let reconnected = false;
  const pendingStore = new StreamingStore({ pendingSubmissions: pendingSubmissionsReducer }, []);
  onDestroy(pendingStore.init());
  const scope: SubmissionScope = {
    agentId: 'queue-images-agent',
    workspaceId: 'queue-images',
    principalId: 'image-author',
    authority: 'test-host',
    participation: 'admitted',
    owner: 'test-owner',
  };
  pendingStore.dispatch(pendingScopeActivated(scope, 1));
  let revision = $state(0);
  const submissions: SubmissionInput[] = [];
  const displayRows = $derived.by(() => {
    void revision;
    return projectSubmissions
      ? projectPendingSubmissions(
          pendingStore.state.pendingSubmissions.byAgentId[scope.agentId],
          messages,
        ).queue
      : undefined;
  });
  function fresh() {
    for (const kind of ['queue', 'history'] as const) {
      const entry = pendingStore.state.pendingSubmissions.byAgentId[scope.agentId];
      const read = { scope, kind, id: crypto.randomUUID(), generation: entry.generation };
      pendingStore.dispatch(pendingReadStarted(read));
      pendingStore.dispatch(
        pendingReadCompleted(read, kind === 'queue' ? $state.snapshot(messages) : [], Date.now()),
      );
    }
    revision += 1;
  }
  function submit(content: string, imageIds: string[] = [], file = false) {
    const submission = admitPendingSubmission(pendingStore, scope, {
      content,
      destination: 'queue',
      imageBlocks: imageIds.map((attachmentId) => ({ type: 'image', attachmentId })),
      fileBlocks: file ? [{ type: 'file', attachmentId: 'document', fileName: 'notes.txt' }] : [],
    });
    if (submission) submissions.push(submission);
    revision += 1;
  }
  function confirmed(submission: SubmissionInput, index: number): QueuedMessage {
    return {
      ...submission,
      queuedAt: '2026-10-05T12:00:00Z',
      position: index,
      submissionIds: [submission.id],
      mergeEligible: index === submissions.length - 1,
      author: { principalId: scope.principalId, login: null, displayName: null, avatarUrl: null },
    };
  }
  function acknowledge(index: number) {
    const submission = submissions.at(index);
    if (!submission) return;
    pendingStore.dispatch(
      pendingSubmissionSettled(
        scope,
        submission.id,
        'accepted',
        Date.now(),
        confirmed(submission, index),
      ),
    );
    revision += 1;
  }
  function confirmAll() {
    messages = submissions.map(confirmed);
    fresh();
  }
  const listeners = new Map<string, (...args: unknown[]) => void>();
  setContext(WORKSPACE_ROUTE_CONTEXT, { workspaceId: WorkspaceId('queue-images') });
  $effect(() => {
    messages = structuredClone($state.snapshot(incoming));
    if (projectSubmissions) untrack(fresh);
  });

  // eslint-disable-next-line intent/no-component-async-data-fetch -- Test-only attachment transport and reconnect fixture.
  installMockElectronBridge({
    'file.getAttachmentInfo': (params) => {
      const request = params as { attachmentId: string; workspaceId: string };
      requests = [...requests, request];
      if (request.attachmentId === 'second' && lookupFails && !reconnected)
        throw new Error('Attachment lookup temporarily unavailable');
      return {
        attachmentId: request.attachmentId,
        fileName: `${request.attachmentId}.png`,
        path: `.intent/attachments/${request.attachmentId}.png`,
        mimeType: 'image/png',
        size: 100,
        uploadedAt: '2026-10-05T12:00:00Z',
        exists: request.attachmentId !== 'missing',
      };
    },
  });
  const api = window.electronAPI!;
  const originalOn = api.on;
  const originalOffById = api.offById;
  api.on = (channel, callback) => {
    if (channel !== IPC_CHANNELS.BACKEND.STATUS) return originalOn(channel, callback);
    const id = `queue-images-listener-${listeners.size}`;
    listeners.set(id, callback);
    return id;
  };
  api.offById = (channel, id) => {
    if (channel !== IPC_CHANNELS.BACKEND.STATUS || !listeners.delete(id))
      originalOffById(channel, id);
  };
  onDestroy(() => {
    api.on = originalOn;
    api.offById = originalOffById;
  });
</script>

<!-- i18n-ignore (isolated functional test controls) -->
<section class="w-[420px] bg-background p-4" data-testid="queued-image-host">
  <QueuedMessageList
    {messages}
    {displayRows}
    ownPrincipalId="image-author"
    onedit={async (id, content, editing) => {
      messages = messages.map((message) =>
        message.id === id
          ? {
              ...message,
              content,
              editing,
              ...(content !== message.content && !editing && message.deliveryGroups?.length
                ? {
                    deliveryGroups: undefined,
                    imageBlocks: message.deliveryGroups.flatMap((group) => group.imageBlocks ?? []),
                    fileBlocks: message.deliveryGroups.flatMap((group) => group.fileBlocks ?? []),
                  }
                : {}),
            }
          : message,
      );
      return { success: true };
    }}
    onremove={(id) => {
      messages = messages.filter((message) => message.id !== id);
    }}
    onsendnow={(id) => {
      sent = messages.find((message) => message.id === id) ?? null;
      messages = messages.filter((message) => message.id !== id);
    }}
  />
  {#if projectSubmissions}
    <div role="group" aria-label="Submission controls">
      <Button onclick={() => submit('First text message')}>Queue text</Button>
      <Button onclick={() => submit('Second image message', ['second'])}>Queue second image</Button>
      <Button onclick={() => submit('Third multiple-image message', ['third', 'fourth'])}
        >Queue multiple images</Button
      >
      <Button onclick={() => submit('', ['first'])}>Queue image only</Button>
      <Button onclick={() => submit('File message', [], true)}>Queue file</Button>
      <Button onclick={() => acknowledge(submissions.length - 1)}>Acknowledge last</Button>
      <Button onclick={() => acknowledge(1)}>Acknowledge second</Button>
      <Button onclick={confirmAll}>Confirm queue</Button>
    </div>
  {/if}
  <output hidden data-testid="queue-projection">{JSON.stringify(displayRows)}</output>
  <Button
    onclick={() => {
      reconnected = true;
      for (const listener of listeners.values())
        listener({ status: 'connected', reconnected: true });
    }}>Reconnect backend</Button
  >
  <output hidden data-testid="image-requests">{JSON.stringify(requests)}</output>
  <output hidden data-testid="sent-images">{JSON.stringify(sent)}</output>
</section>
