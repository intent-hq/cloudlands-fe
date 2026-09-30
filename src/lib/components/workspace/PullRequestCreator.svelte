<script lang="ts">
  import {
    prCreatorRequested,
    prWorkflowRequested,
  } from '$store/renderer/slices/pr-workflow/pr-workflow-slice';
  import { selectPRWorkflow } from '$store/renderer/slices/pr-workflow/pr-workflow-selectors';
  import { selectAcceptChangesState } from '$store/renderer/slices/changes/changes-selectors';
  import { setPRContent } from '$store/renderer/slices/changes/changes-slice';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { Badge } from '$lib/components/ui/badge';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';

  import {
    faCodePullRequest,
    faExclamationCircle,
    faCircleCheck,
    faMagic,
    faPaperPlane,
    faCodeBranch,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { PullRequestInfo } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { toStore } from 'svelte/store';
  import { onDestroy } from 'svelte';

  interface Props {
    workspaceId?: WorkspaceId | null;
    onClose?: () => void;
    onCreated?: (pr: PullRequestInfo) => void;
  }

  let { workspaceId, onClose, onCreated }: Props = $props();
  const workspaceId$ = toStore(() => workspaceId ?? '');
  const workspace$ = selectWorkspaceById(workspaceId$);

  const workflow$ = selectPRWorkflow(workspaceId$);
  const draft$ = selectAcceptChangesState(workspaceId$);
  let activeRequestId = $state('');
  let activeKind = $state<'prepare-pr' | 'create-pr'>('prepare-pr');
  let autoCreateRequested = $state(false);
  const operation = $derived($workflow$.operations[activeKind]);
  const currentOperation = $derived(
    operation?.requestId === activeRequestId ? operation : undefined,
  );
  const generatingContent = $derived(
    activeKind === 'prepare-pr' && currentOperation?.status === 'pending',
  );
  const autoCreatePending = $derived(autoCreateRequested && generatingContent);
  const creatingPR = $derived(activeKind === 'create-pr' && currentOperation?.status === 'pending');
  const error = $derived(currentOperation?.result?.error ?? null);
  const success = $derived(
    currentOperation?.result?.success === true && currentOperation.result.prNumber !== undefined,
  );
  const formData = $derived({
    title: { value: $draft$.prTitle, loading: generatingContent },
    description: { value: $draft$.prDescription, loading: generatingContent },
  });
  let mounted = true;
  onDestroy(() => {
    mounted = false;
  });

  function generatePRContent() {
    if (!workspaceId) return;
    autoCreateRequested = false;
    const request = prWorkflowRequested(workspaceId, { kind: 'prepare-pr' });
    activeKind = 'prepare-pr';
    activeRequestId = request.payload.requestId;
    appStore.dispatch(request);
  }

  async function submitCreator(generate: boolean) {
    const origin = workspaceId;
    if (!origin) return;
    autoCreateRequested = generate;
    const requestId = crypto.randomUUID();
    activeRequestId = requestId;
    activeKind = generate ? 'prepare-pr' : 'create-pr';
    const result = await appStore.dispatch(prCreatorRequested(origin, generate, requestId));
    if (!mounted || workspaceId !== origin || activeRequestId !== requestId || !result.success)
      return;
    // Only presentation callbacks remain here; transport, reconciliation and delay belong to the saga.
    const pr = selectWorkspaceById.select(appStore.state, origin)?.activePullRequest;
    if (pr) onCreated?.(pr);
    onClose?.();
  }

  function generateAndCreate() {
    return submitCreator(true);
  }
  function createPullRequest() {
    return submitCreator(false);
  }
</script>

<div class="flex flex-col h-full bg-background">
  <!-- Header -->
  <div class="flex items-center justify-between px-6 py-4 border-b border-border">
    <div class="flex items-center gap-3">
      <Fa icon={faCodePullRequest} size="lg" />
      <h2 class="text-lg font-semibold">{m.workspace_prCreator_title()}</h2>
      {#if $workspace$?.branch}
        <Badge variant="secondary" class="text-xs">
          <Fa icon={faCodeBranch} size="xs" class="mr-1" />
          {$workspace$.branch}
        </Badge>
      {/if}
    </div>
    {#if onClose}
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={onClose}
        aria-label={m.workspace_prCreator_close_ariaLabel()}
      >
        <Fa icon={faXmark} size="sm" />
      </Button>
    {/if}
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-4xl mx-auto p-6 space-y-6">
      {#if error}
        <div class="flex items-start gap-2 p-3 bg-danger-background/10 text-danger rounded-lg">
          <Fa icon={faExclamationCircle} size="sm" class="mt-0.5" />
          <span class="text-sm">{error}</span>
        </div>
      {/if}

      {#if success}
        <div class="flex items-center gap-2 p-4 bg-green-500/10 text-green-600 rounded-lg">
          <Fa icon={faCircleCheck} size="lg" />
          <span>{m.workspace_prCreator_createdSuccess_label()}</span>
        </div>
      {:else}
        <!-- Title Field -->
        <div class="space-y-2">
          <label for="pr-title" class="text-sm font-medium"
            >{m.workspace_prCreator_titleField_label()}</label
          >
          {#if formData.title.loading}
            <Skeleton class="h-10 w-full" />
          {:else}
            <Input
              id="pr-title"
              bind:value={
                () => formData.title.value,
                (value) =>
                  appStore.dispatch(
                    setPRContent(workspaceId ?? '', String(value), formData.description.value),
                  )
              }
              placeholder={m.workspace_prCreator_titleField_placeholder()}
              disabled={creatingPR}
            />
          {/if}
        </div>

        <!-- Description Field -->
        <div class="space-y-2">
          <label for="pr-description" class="text-sm font-medium"
            >{m.workspace_prCreator_descriptionField_label()}</label
          >
          {#if formData.description.loading}
            <div class="space-y-2">
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-4 w-3/4" />
              <Skeleton class="h-4 w-5/6" />
              <Skeleton class="h-4 w-2/3" />
            </div>
          {:else}
            <Textarea
              id="pr-description"
              bind:value={
                () => formData.description.value,
                (value) =>
                  appStore.dispatch(setPRContent(workspaceId ?? '', formData.title.value, value))
              }
              placeholder={m.workspace_prCreator_descriptionField_placeholder()}
              class="min-h-[200px] font-mono text-sm"
              disabled={creatingPR}
            />
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Footer -->
  {#if !success}
    <div class="flex items-center justify-between px-6 py-4 border-t border-border">
      <div class="text-xs text-subtle">
        {#if generatingContent && autoCreatePending}
          {m.workspace_prCreator_generatingAndCreating_label()}
        {:else if generatingContent}
          {m.workspace_prCreator_generatingContent_label()}
        {:else if creatingPR}
          {m.workspace_prCreator_creatingPr_label()}
        {:else if formData.title.value}
          {m.workspace_prCreator_reviewGenerated_label()}
        {:else}
          {m.workspace_prCreator_fillDetails_label()}
        {/if}
      </div>
      <div class="flex gap-2">
        {#if onClose}
          <Button variant="outline" onclick={onClose} disabled={creatingPR || generatingContent}
            >{m.workspace_prCreator_cancel_label()}</Button
          >
        {/if}
        <Button
          onclick={generatePRContent}
          disabled={generatingContent || creatingPR}
          variant="ghost"
          class="gap-1.5"
        >
          {#if generatingContent && !autoCreatePending}
            <IntentMarkLoader size={14} />
            {m.workspace_prCreator_generating_label()}
          {:else}
            <Fa icon={faMagic} size="sm" />
            {m.workspace_prCreator_autoFill_label()}
          {/if}
        </Button>
        <Button
          onclick={generateAndCreate}
          disabled={generatingContent || creatingPR}
          variant="outline"
          class="gap-1.5"
        >
          {#if autoCreatePending}
            <IntentMarkLoader size={14} />
            {generatingContent
              ? m.workspace_prCreator_generating_label()
              : m.workspace_prCreator_creating_label()}
          {:else}
            <Fa icon={faMagic} size="sm" />
            {m.workspace_prCreator_autoFillCreate_label()}
          {/if}
        </Button>
        <Button
          onclick={createPullRequest}
          disabled={generatingContent || creatingPR || !formData.title.value}
        >
          {#if creatingPR && !autoCreatePending}
            <IntentMarkLoader size={14} />
            {m.workspace_prCreator_creating_label()}
          {:else}
            <Fa icon={faPaperPlane} size="sm" />
            {m.workspace_prCreator_create_label()}
          {/if}
        </Button>
      </div>
    </div>
  {/if}
</div>
