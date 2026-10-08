<script lang="ts">
  import { onMount } from 'svelte';
  import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';
  import { store } from '$store/renderer/store';
  import { admitAgentSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-admission';
  import {
    pendingEvidenceObserved,
    pendingSubmissionAccepted,
    pendingSubmissionSettled,
  } from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
  import type { SubmissionScope } from '$store/renderer/slices/pending-submissions/pending-submissions-types';
  import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';

  let {
    stage = 'pending',
    id = 'user-msg-868b24f0-0c82-448c-9fd0-1882343cd19c',
    settleSubmission,
  }: {
    id?: string;
    stage?: 'pending' | 'processing' | 'history';
    settleSubmission?: 'rejected';
  } = $props();
  const agentId = 'regular-composer-agent';
  const workspaceId = 'chat-panel-composer-geometry';
  const content = 'Continue after the provider failure';
  const queuedAt = '2026-10-06T08:30:00.000Z';
  let scope: SubmissionScope | undefined;
  let ready = $state(false);

  onMount(() => {
    const admission = admitAgentSubmission(store, agentId, workspaceId, 1, {
      content,
      destination: 'conversation',
    });
    if (!admission) throw new Error('Submission fixture could not capture ownership');
    scope = admission.scope;
    store.dispatch(pendingSubmissionSettled(scope, admission.submission.id, 'rejected', 0));
    // Supply the daemon's ID shape at the production reducer boundary.
    store.dispatch(
      pendingSubmissionAccepted(scope, {
        id,
        content,
        destination: 'conversation',
        createdAt: Date.parse(queuedAt),
        messageMetadata: { submissionIds: [id] },
      }),
    );
    ready = true;
  });

  $effect(() => {
    if (!ready || !scope || stage === 'pending') return;
    const author = {
      principalId: scope.principalId,
      login: null,
      displayName: null,
      avatarUrl: null,
    };
    store.dispatch(
      pendingEvidenceObserved(
        scope,
        stage,
        [{ id, content, queuedAt, position: 0, author, submissionIds: [id] }],
        Date.parse(queuedAt),
      ),
    );
    if (stage === 'history') {
      store.dispatch(
        updateSession(agentId, {
          messages: [
            {
              id,
              role: 'user',
              timestamp: queuedAt,
              contentBlocks: [{ type: 'text', text: content }],
              author,
              metadata: { submissionIds: [id] },
            },
          ],
        }),
      );
    }
  });
</script>

<ChatPanelComposerGeometryHost followUp="discussion" submissionSupport={true} {settleSubmission} />
