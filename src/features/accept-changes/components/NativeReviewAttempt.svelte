<script module lang="ts">
  import { store } from '$store/renderer/store';
  import {
    selectRepositoryContextForDemand,
    selectNativeReviewForOwner,
  } from '$store/renderer/slices/repository-context/repository-context-selectors';
  import { repositoryRootKey, type RepositoryRootIdentity } from '$shared/types/repository-context';
  import type { RepositoryContextDemand } from '$store/renderer/slices/repository-context/repository-context-types';
  import type { NativeReviewOwner } from '$shared/types/native-review-operation';

  const selectRead = store.createSelector(
    (state, demand: RepositoryContextDemand | null, root: RepositoryRootIdentity) => {
      const view = demand ? selectRepositoryContextForDemand.select(state, demand) : null;
      const entry =
        view?.status === 'ready'
          ? view.roots.find((item) => repositoryRootKey(item.root) === repositoryRootKey(root))
          : undefined;
      return {
        view,
        target:
          entry?.reviewSelection.outcome.state === 'resolved'
            ? entry.reviewSelection.outcome.target
            : null,
      };
    },
  );
  const selectAttempt = store.createSelector((state, owner: NativeReviewOwner | null) =>
    owner ? selectNativeReviewForOwner.select(state, owner) : null,
  );
</script>

<script lang="ts">
  import { onDestroy, tick, type Snippet } from 'svelte';
  import { toStore } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Form, FormField, FormActions } from '$lib/components/patterns/form';
  import { DataList } from '$lib/components/patterns/collection';
  import { confirm } from '$lib/components/patterns/confirm';
  import { formatDateTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { NativeReviewExecution } from '$shared/types/native-review';
  import { projectNativeReviewResult } from '../native-review-result';
  import { selectPrincipalAdmissionContext } from '$store/renderer/slices/principal/principal-selectors';
  import { selectWorkspaceHostOperationContext } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    repositoryContextDemanded,
    repositoryContextDemandEnded,
    nativeReviewEditRequested,
    nativeReviewConfirmRequested,
    nativeReviewReconcileRequested,
    nativeReviewEditEnded,
  } from '$store/renderer/slices/repository-context/repository-context-slice';

  let {
    root,
    targetBranch,
    legacy,
    onLegacyEligibility,
    onClose,
  }: {
    root: RepositoryRootIdentity;
    targetBranch?: string;
    legacy?: Snippet;
    onClose?: () => void;
    onLegacyEligibility?: (eligible: () => boolean) => void;
  } = $props();
  let demand = $state.raw<RepositoryContextDemand | null>(null);
  let owner = $state.raw<NativeReviewOwner | null>(null);
  let title = $state('');
  let body = $state('');
  let titleEdited = $state(false);
  let bodyEdited = $state(false);
  let seeded = $state<string | null>(null);
  let confirming = $state<string | null>(null);
  let submitted = $state<string | null>(null);
  let checking = $state(false);
  let startButton = $state<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const admission = selectPrincipalAdmissionContext();
  const hostAdmission = selectWorkspaceHostOperationContext(toStore(() => root.workspaceId));
  const read = selectRead(
    toStore(() => demand),
    toStore(() => root),
  );
  const attempt = selectAttempt(toStore(() => owner));
  const view = $derived($attempt);
  const observation = $derived(view?.observation);
  const execute = $derived(observation?.execute);
  const projected = $derived(execute ? projectNativeReviewResult(execute) : null);
  const canConfirm = $derived(
    view?.status === 'ready' && view.preview?.valid && !!title.trim() && !confirming && !submitted,
  );
  const unknown = () => m.repository_details_unknown_label();

  function endAttempt() {
    const original = owner;
    owner = null;
    confirming = null;
    submitted = null;
    checking = false;
    seeded = null;
    if (original) store.dispatch(nativeReviewEditEnded(original));
  }
  function endRead() {
    const original = demand;
    demand = null;
    if (original)
      store.dispatch(
        repositoryContextDemandEnded(original.workspaceId, original.demandId, original.admission),
      );
  }
  function start() {
    endAttempt();
    endRead();
    const original = Object.freeze({
      workspaceId: root.workspaceId,
      demandId: crypto.randomUUID(),
      admission: selectPrincipalAdmissionContext.select(store.state),
    });
    demand = original;
    store.dispatch(
      repositoryContextDemanded(original.workspaceId, original.demandId, original.admission),
    );
  }
  function legacyEligible() {
    const current = selectRead.select(store.state, demand, root);
    return (
      !owner &&
      current.target?.provider === 'github' &&
      selectWorkspaceHostOperationContext.select(store.state, root.workspaceId) !== null
    );
  }
  function prepare() {
    if (owner || selectRead.select(store.state, demand, root).target?.provider !== 'gitlab') return;
    const capturedAdmission = selectPrincipalAdmissionContext.select(store.state);
    const hostContext = selectWorkspaceHostOperationContext.select(store.state, root.workspaceId);
    if (!capturedAdmission || !hostContext) return;
    const original: NativeReviewOwner = Object.freeze({
      root: Object.freeze({ ...root }),
      attemptId: crypto.randomUUID(),
      admission: capturedAdmission,
      hostContext,
    });
    owner = original;
    store.dispatch(
      nativeReviewEditRequested(original, {
        workspaceId: original.root.workspaceId,
        action: 'create-pr',
        review: {
          root: original.root,
          choice: { kind: 'saved' },
          ...(targetBranch ? { targetBranch } : {}),
        },
      }),
    );
  }
  function eligible(original: NativeReviewOwner) {
    return (
      owner === original &&
      // eslint-disable-next-line intent/no-component-async-data-fetch -- Pure shared root keys, following the existing selection editor; no client or IO.
      repositoryRootKey(root) === repositoryRootKey(original.root) &&
      selectNativeReviewForOwner.select(store.state, original)?.status === 'ready' &&
      submitted !== original.attemptId
    );
  }
  async function submit() {
    const original = owner;
    if (!original || !canConfirm || !eligible(original)) return;
    const command = Object.freeze({ prTitle: title.trim(), prBody: body });
    const preparation = view?.preview?.reviewPreparation;
    if (!preparation) return;
    confirming = original.attemptId;
    try {
      const agreed = await confirm({
        title: m.native_review_confirm_title(),
        description: m.native_review_confirm_description({
          title: command.prTitle,
          project:
            preparation.target.repository.projectPath +
            ' (' +
            preparation.target.repository.instanceBaseUrl +
            ')',
          source: preparation.source.branch,
          target: preparation.target.branch,
        }),
        confirmLabel: m.workspace_prCreator_create_label(),
        cancelLabel: m.workspace_prCreator_cancel_label(),
      });
      if (!agreed || !eligible(original)) return;
      submitted = original.attemptId;
      store.dispatch(nativeReviewConfirmRequested(original, command));
    } finally {
      if (confirming === original.attemptId) confirming = null;
    }
  }
  function reconcile() {
    const original = owner;
    if (!original || checking || !selectNativeReviewForOwner.select(store.state, original)) return;
    checking = true;
    store.dispatch(nativeReviewReconcileRequested(original));
  }
  function dismiss() {
    endAttempt();
    endRead();
    onClose?.();
  }
  async function close() {
    endAttempt();
    endRead();
    await tick();
    startButton?.focus();
  }
  $effect(() => {
    onLegacyEligibility?.(legacyEligible);
    return () => onLegacyEligibility?.(() => false);
  });
  $effect(() => {
    const original = owner;
    if (
      original &&
      // eslint-disable-next-line intent/no-component-async-data-fetch -- Pure identity comparison before original-owner cleanup.
      (repositoryRootKey(root) !== repositoryRootKey(original.root) ||
        (original.admission !== $admission &&
          original.admission !== selectPrincipalAdmissionContext.select(store.state)) ||
        (original.hostContext !== $hostAdmission &&
          original.hostContext !==
            selectWorkspaceHostOperationContext.select(store.state, root.workspaceId)))
    )
      endAttempt();
    if (
      demand &&
      (demand.workspaceId !== root.workspaceId ||
        (demand.admission !== $admission &&
          demand.admission !== selectPrincipalAdmissionContext.select(store.state)))
    )
      endRead();
  });
  $effect(() => {
    if (owner && view?.preview && seeded !== owner.attemptId) {
      if (!titleEdited && !title) title = view.preview.suggestedPRTitle ?? '';
      if (!bodyEdited && !body) body = view.preview.suggestedPRBody ?? '';
      seeded = owner.attemptId;
    }
  });
  $effect(() => {
    if (observation) checking = false;
  });
  onDestroy(() => {
    endAttempt();
    endRead();
  });

  const stateLabel = (state: string | null) =>
    state === 'open'
      ? m.native_review_open_label()
      : state === 'closed'
        ? m.native_review_closed_label()
        : state === 'merged'
          ? m.native_review_merged_label()
          : state === 'locked'
            ? m.native_review_locked_label()
            : unknown();
</script>

{#snippet executionDetails(execution: NativeReviewExecution)}
  {@const outcome = execution.outcome}
  {@const review =
    outcome.status === 'created' || outcome.status === 'reused' ? outcome.review : null}
  <p class="font-medium" data-native-outcome={outcome.status}>
    {outcome.status === 'created'
      ? m.native_review_created_label()
      : outcome.status === 'reused'
        ? m.native_review_reused_label()
        : outcome.status === 'not-attempted'
          ? m.native_review_notAttempted_label()
          : outcome.status === 'failed'
            ? m.native_review_failed_label()
            : m.native_review_uncertain_description()}
  </p>
  {#if outcome.status === 'failed' || outcome.status === 'uncertain'}
    <p class="break-words">{outcome.message}</p>
  {/if}
  {#if review}
    <p class="break-all">
      <a href={review.url} target="_blank" rel="noreferrer">{review.title}</a>
    </p>
    <DataList
      items={[
        {
          key: 'project',
          label: m.repository_details_project_label(),
          value: review.resource.repository.projectPath,
        },
        {
          key: 'instance',
          label: m.repository_details_instance_label(),
          value: review.resource.repository.instanceBaseUrl,
        },
        {
          key: 'sourceBranch',
          label: m.native_review_source_label(),
          value: review.sourceBranch ?? unknown(),
        },
        {
          key: 'targetBranch',
          label: m.native_review_target_label(),
          value: review.targetBranch ?? unknown(),
        },
        { key: 'state', label: m.native_review_state_label(), value: stateLabel(review.state) },
        {
          key: 'draft',
          label: m.native_review_readiness_label(),
          value:
            review.draft === null
              ? unknown()
              : review.draft
                ? m.native_review_draft_label()
                : m.native_review_ready_label(),
        },
        {
          key: 'sha',
          label: m.native_review_reviewSha_label(),
          value: review.headSha ?? unknown(),
        },
        {
          key: 'created',
          label: m.native_review_createdAt_label(),
          value: review.createdAt === null ? unknown() : formatDateTime(review.createdAt),
        },
        {
          key: 'updated',
          label: m.native_review_updatedAt_label(),
          value: review.updatedAt === null ? unknown() : formatDateTime(review.updatedAt),
        },
      ]}
    />
  {/if}
  <p data-native-publication={execution.publication.state}>
    {execution.publication.state === 'included'
      ? m.native_review_included_description()
      : execution.publication.state === 'local-ahead'
        ? m.native_review_localAhead_description()
        : execution.publication.state === 'diverged'
          ? m.native_review_diverged_description()
          : execution.publication.state === 'remote-branch-missing'
            ? m.native_review_missingBranch_description()
            : m.native_review_unknownPublication_description()}
  </p>
  <DataList
    items={[
      {
        key: 'local',
        label: m.native_review_localSha_label(),
        value: execution.publication.localHeadSha ?? unknown(),
      },
      {
        key: 'remote',
        label: m.native_review_remoteSha_label(),
        value:
          'remoteSourceSha' in execution.publication
            ? (execution.publication.remoteSourceSha ?? unknown())
            : unknown(),
      },
    ]}
  />
  {#each execution.gitReceipts as receipt, index (index)}
    <p class="break-all" data-native-receipt>
      {receipt.stage === 'commit'
        ? m.native_review_commitReceipt_description({ sha: receipt.commitHash })
        : m.native_review_pushReceipt_description({ sha: receipt.pushedSha })}
    </p>
  {/each}
{/snippet}

{#if demand && !owner && $read.target?.provider === 'github' && legacy && $hostAdmission}
  {@render legacy()}
{:else}
  <section class="min-w-0 space-y-3 p-4 type-body" aria-label={m.native_review_title_label()}>
    <div class="flex items-center justify-between gap-2">
      <h2 class="type-title">
        {owner || $read.target?.provider === 'gitlab'
          ? m.native_review_title_label()
          : m.native_review_start_label()}
      </h2>
      {#if onClose}<Button variant="ghost" onclick={dismiss}
          >{m.workspace_prCreator_cancel_label()}</Button
        >{/if}
    </div>
    <p>{m.native_review_createOnly_description()}</p>
    <Button bind:ref={startButton} variant="secondary" onclick={start}
      >{m.native_review_start_label()}</Button
    >
    {#if demand && !owner}
      {#if $read.view?.status === 'loading'}
        <p role="status">{m.repository_details_loading_description()}</p>
      {:else if $read.target?.provider === 'gitlab'}
        <DataList
          items={[
            {
              key: 'project',
              label: m.repository_details_project_label(),
              value: $read.target.projectPath,
            },
            {
              key: 'instance',
              label: m.repository_details_instance_label(),
              value: $read.target.instanceBaseUrl,
            },
          ]}
        />
        <Button variant="primary" onclick={prepare} disabled={!$hostAdmission}
          >{m.native_review_prepare_label()}</Button
        >
        {#if !$hostAdmission}<p role="status">{m.native_review_unavailable_description()}</p>{/if}
      {:else}
        <p role="status">{m.native_review_unavailable_description()}</p>
      {/if}
    {/if}
    {#if owner}
      {#if !view}
        <p role="status">{m.native_review_inactive_description()}</p>
      {:else}
        {#if view.status === 'capturing'}<p role="status">
            {m.native_review_preparing_description()}
          </p>{/if}
        {#if view.status === 'unavailable'}<p role="status">
            {m.native_review_unavailable_description()}
          </p>{/if}
        {#if view.status === 'retired' || observation?.current === false}<p role="status">
            {m.native_review_historical_description()}
          </p>{/if}
        {#if view.preview}
          <DataList
            items={[
              {
                key: 'project',
                label: m.repository_details_project_label(),
                value: view.preview.reviewPreparation.target.repository.projectPath,
              },
              {
                key: 'instance',
                label: m.repository_details_instance_label(),
                value: view.preview.reviewPreparation.target.repository.instanceBaseUrl,
              },
              {
                key: 'source',
                label: m.native_review_source_label(),
                value: view.preview.reviewPreparation.source.branch,
              },
              {
                key: 'target',
                label: m.native_review_target_label(),
                value: view.preview.reviewPreparation.target.branch,
              },
            ]}
          />
          {#each [...view.preview.warnings, ...view.preview.errors] as message, index (index)}<p
              role="status"
            >
              {message}
            </p>{/each}
        {/if}
        <Form onSubmit={submit} busy={!!confirming}>
          <FormField label={m.workspace_prCreator_titleField_label()}>
            {#snippet control(props)}<Input
                {...props}
                bind:value={title}
                oninput={() => (titleEdited = true)}
                disabled={!!submitted || !!confirming}
              />{/snippet}
          </FormField>
          <FormField label={m.workspace_prCreator_descriptionField_label()}>
            {#snippet control(props)}<Textarea
                {...props}
                bind:value={body}
                oninput={() => (bodyEdited = true)}
                disabled={!!submitted || !!confirming}
              />{/snippet}
          </FormField>
          <FormActions>
            {#snippet primary()}
              <Button type="submit" variant="primary" disabled={!canConfirm}
                >{m.workspace_prCreator_create_label()}</Button
              >
            {/snippet}
          </FormActions>
        </Form>
        {#if submitted && !observation}<p role="status">
            {m.native_review_pending_description()}
          </p>{/if}
        {#if observation?.uncertain}<p role="status">
            {m.native_review_uncertain_description()}
          </p>{/if}
        {#if execute}
          <section aria-label={m.native_review_execution_label()} class="space-y-2">
            <h3 class="font-medium">{m.native_review_execution_label()}</h3>
            {#if execute.error}<p role="alert">{execute.error}</p>{/if}
            {#each execute.steps as step (step.id)}{#if step.error}<p role="alert">
                  {step.error}
                </p>{/if}{/each}
            {#if !execute.success}<p>{m.native_review_incomplete_description()}</p>{/if}
            {#if projected?.kind === 'native'}{@render executionDetails(
                projected.execution,
              )}{:else}<p>
                {m.native_review_pending_description()}
              </p>{/if}
          </section>
        {/if}
        {#if observation?.reconciliation}
          <section aria-label={m.native_review_reconciliation_label()} class="space-y-2">
            <h3 class="font-medium">{m.native_review_reconciliation_label()}</h3>
            {#if observation.reconciliation.reviewExecution}{@render executionDetails(
                observation.reconciliation.reviewExecution,
              )}{:else}<p>{m.native_review_pending_description()}</p>{/if}
          </section>
        {/if}
        {#if submitted || observation}
          <Button variant="secondary" onclick={reconcile} disabled={checking}
            >{m.repository_selection_check_label()}</Button
          >
        {/if}
      {/if}
      <Button variant="ghost" onclick={close}>{m.repository_selection_close_label()}</Button>
    {/if}
  </section>
{/if}
