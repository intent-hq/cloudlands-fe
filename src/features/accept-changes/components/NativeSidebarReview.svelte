<script lang="ts">
  import type { createNativeSidebarReview } from '../native-sidebar-review.svelte';
  import type { NativeReviewExecution } from '$shared/types/native-review';
  import type { NativeReviewObservation } from '$shared/types/native-review-operation';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { store as appStore } from '$store/renderer/store';
  import { setPRWorkflowDrawer } from '$store/renderer/slices/pr-workflow/pr-workflow-slice';
  import TimelineDivider from '$lib/components/workspace/sidebar/TimelineDivider.svelte';
  import DividerButton from '$lib/components/workspace/sidebar/DividerButton.svelte';
  import DividerPanel from '$lib/components/workspace/sidebar/DividerPanel.svelte';
  import PrRepositorySelect from './PrRepositorySelect.svelte';
  let {
    review,
    entry = false,
  }: { review: ReturnType<typeof createNativeSidebarReview>; entry?: boolean } = $props();
</script>

{#snippet nativeFacts(execution: NativeReviewExecution | undefined)}
  {#if execution}
    {@const outcome = execution.outcome}
    {#each execution.gitReceipts as receipt, index (index)}
      <p class="break-all" data-native-receipt>
        {receipt.stage === 'commit'
          ? m.native_review_commitReceipt_description({ sha: receipt.commitHash })
          : m.native_review_pushReceipt_description({ sha: receipt.pushedSha })}
      </p>
    {/each}
    {#if outcome.status === 'created' || outcome.status === 'reused'}
      <p data-native-outcome={outcome.status}>
        {outcome.status === 'created'
          ? m.native_review_created_label()
          : m.native_review_reused_label()}
      </p>
      <a class="break-all" href={outcome.review.url} target="_blank" rel="noreferrer"
        >{outcome.review.title}</a
      >
      <p class="break-all">
        {outcome.review.resource.repository.projectPath} ({outcome.review.resource.repository
          .instanceBaseUrl})
      </p>
      <p>
        {m.native_review_source_label()}: {outcome.review.sourceBranch ??
          m.repository_details_unknown_label()}
      </p>
      <p>
        {m.native_review_target_label()}: {outcome.review.targetBranch ??
          m.repository_details_unknown_label()}
      </p>
    {:else if outcome.status === 'failed' || outcome.status === 'uncertain'}
      <p data-native-outcome={outcome.status}>
        {outcome.status === 'failed'
          ? m.native_review_failed_label()
          : m.native_review_uncertain_description()}
      </p>
      <p class="break-words">{outcome.message}</p>
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
    <p class="break-all">
      {m.native_review_localSha_label()}: {execution.publication.localHeadSha ??
        m.repository_details_unknown_label()}
    </p>
    <p class="break-all">
      {m.native_review_remoteSha_label()}: {'remoteSourceSha' in execution.publication
        ? (execution.publication.remoteSourceSha ?? m.repository_details_unknown_label())
        : m.repository_details_unknown_label()}
    </p>
  {/if}
{/snippet}

{#snippet nativeObservationDetails(observation: NativeReviewObservation)}
  {#if observation.execute}
    {@const execute = observation.execute}
    <section aria-label={m.native_review_execution_label()} class="space-y-2">
      <h3 class="font-medium">{m.native_review_execution_label()}</h3>
      {#if execute.error}<p role="alert" class="break-words">{execute.error}</p>{/if}
      {#each execute.steps as step (step.id)}
        {#if step.error}<p role="alert" class="break-words">{step.error}</p>{/if}
      {/each}
      {#if !execute.success}<p>{m.native_review_incomplete_description()}</p>{/if}
      {#if execute.reviewExecution}
        {@render nativeFacts(execute.reviewExecution)}
      {:else}<p>{m.native_review_pending_description()}</p>{/if}
    </section>
  {/if}
  {#if observation.reconciliation}
    <section aria-label={m.native_review_reconciliation_label()} class="space-y-2">
      <h3 class="font-medium">{m.native_review_reconciliation_label()}</h3>
      {#if observation.reconciliation.reviewExecution}
        {@render nativeFacts(observation.reconciliation.reviewExecution)}
      {:else}<p>{m.native_review_pending_description()}</p>{/if}
    </section>
  {/if}
{/snippet}

{#snippet nativeReviewForm()}
  <section
    class="min-w-0 space-y-3"
    aria-label={m.native_review_title_label()}
    data-native-sidebar-review
  >
    {#if entry}
      <PrRepositorySelect
        context={review.nativeRead.entry}
        disabled={!!review.nativeIntent}
        onsaved={review.startNativeRead}
      />
    {/if}
    {#if !review.nativeDemand}<Button onclick={review.startNativeRead}
        >{m.native_review_start_label()}</Button
      >
    {:else if review.nativeRead.view?.status === 'loading'}<p role="status">
        {m.repository_details_loading_description()}
      </p>{/if}
    {#if review.nativeReadChanged && !review.nativeParentClaimed}
      <p role="status">{m.native_review_targetContextChanged_description()}</p>
      <Button onclick={review.startNativeRead}>{m.native_review_start_label()}</Button>
    {/if}
    {#if review.nativeDemand && !review.hostContext}<p role="status">
        {m.native_review_unavailable_description()}
      </p>
    {:else if review.remoteSaving}
      <p role="status">{m.repository_prRemote_saving_label()}</p>
    {:else if review.nativeDemand && (review.nativeRead.target?.provider === 'gitlab' || review.nativeIntent)}
      <label class="block text-xs text-subtle" for="sidebar-native-branch"
        >{m.native_review_target_label()}</label
      >
      <Input
        id="sidebar-native-branch"
        bind:value={review.nativeBranch}
        disabled={!!review.nativeIntent || review.nativeReadChanged}
      />
      <p class="text-xs text-subtle">{m.native_review_targetChoice_description()}</p>
      <label class="block text-xs text-subtle" for="sidebar-native-commit"
        >{m.workspace_mergePanel_commitMessage_label()}</label
      >
      <Input
        id="sidebar-native-commit"
        bind:value={review.nativeMessage}
        disabled={!!review.nativeIntent}
      />
      <label class="block text-xs text-subtle" for="sidebar-native-title"
        >{m.workspace_prCreator_titleField_label()}</label
      >
      <Input
        id="sidebar-native-title"
        value={review.props.prTitle}
        oninput={(event) => review.updateTitle(event.currentTarget.value)}
        disabled={!!review.nativeIntent}
      />
      <label class="block text-xs text-subtle" for="sidebar-native-body"
        >{m.workspace_prCreator_descriptionField_label()}</label
      >
      <Textarea
        id="sidebar-native-body"
        value={review.props.prDescription}
        oninput={(event) => review.updateDescription(event.currentTarget.value)}
        readonly={!!review.nativeIntent}
      />
      {#if review.nativeReadChanged && !review.nativeParentClaimed}<p role="status">
          {m.native_review_targetContextChanged_description()}
        </p>{/if}
      {#if !review.nativeIntent}
        <Button
          onclick={review.prepareNativeCommit}
          disabled={!review.props.hasStaged ||
            !review.nativeBranch.trim() ||
            !review.nativeMessage.trim() ||
            !review.props.prTitle.trim() ||
            review.nativeReadChanged ||
            !review.hostContext}
        >
          {m.workspace_commitDrawer_commit_label()}
        </Button>
      {:else}
        {#if review.nativeParentView?.preview && !review.nativeParentClaimed}
          <p>
            {review.nativeParentView.preview.filesCount === 1
              ? m.workspace_commitDrawer_stagedWillCommit_one()
              : m.workspace_commitDrawer_stagedWillCommit_many({
                  count: formatInteger(review.nativeParentView.preview.filesCount),
                })}
          </p>
        {/if}
        {#if !review.nativeParentClaimed && !review.nativeParentView?.observation}
          <Button
            onclick={() => review.nativeIntent && review.triggerNativeReview(review.nativeIntent)}
            disabled={review.nativeParentView?.status !== 'ready' ||
              !review.nativeParentView.preview?.valid ||
              !!review.nativeConfirming}
          >
            {review.nativeParentView?.status === 'capturing'
              ? m.workspace_prSection_preparing_label()
              : m.workspace_commitDrawer_commit_label()}
          </Button>
          <Button
            variant="secondary"
            onclick={review.endNativeOwners}
            disabled={!!review.nativeConfirming}>{m.native_review_changeTarget_label()}</Button
          >
        {/if}
        {#if !review.nativeParentView || review.nativeParentView.status === 'unavailable'}<p
            role="status"
          >
            {m.native_review_unavailable_description()}
          </p>{/if}
        {#if review.nativeParentClaimed && !review.nativeParentView?.observation}<p role="status">
            {m.native_review_pending_description()}
          </p>{/if}
        {#if review.nativeParentView?.observation}
          {@render nativeObservationDetails(review.nativeParentView.observation)}
          {#if review.nativeParentView.observation.uncertain}<p role="status">
              {m.native_review_uncertain_description()}
            </p>{/if}
          {#if review.nativeParentView.observation.uncertain || review.nativeParentView.observation.execute?.state === 'pending'}<Button
              onclick={() => review.nativeIntent && review.checkNative(review.nativeIntent.owner)}
              disabled={!!review.nativeChecking}>{m.repository_selection_check_label()}</Button
            >{/if}
        {/if}
        {#if review.nativeCanContinue}<Button onclick={review.prepareNativeChild}
            >{m.native_review_prepare_label()}</Button
          >{/if}
        {#if review.nativeChild}
          {#if review.nativeChildView?.status === 'capturing'}<p role="status">
              {m.native_review_preparing_description()}
            </p>{/if}
          {#if !review.nativeChildView || review.nativeChildView.status === 'unavailable'}<p
              role="status"
            >
              {m.native_review_unavailable_description()}
            </p>{/if}
          {#if review.nativeChildView?.preview}
            <p class="break-all" data-native-child-destination>
              {review.nativeChildView.preview.reviewPreparation.target.repository.projectPath} ({review
                .nativeChildView.preview.reviewPreparation.target.repository.instanceBaseUrl})
            </p>
            <p>
              {review.nativeChildView.preview.reviewPreparation.source.branch} → {review
                .nativeChildView.preview.reviewPreparation.target.branch}
            </p>
            {#if !review.nativeChildClaimed}<Button
                onclick={review.confirmNativeChild}
                disabled={review.nativeChildView.status !== 'ready' ||
                  !review.nativeChildView.preview.valid ||
                  !!review.nativeConfirming}>{m.workspace_prCreator_create_label()}</Button
              >{/if}
          {/if}
          {#if review.nativeChildClaimed && !review.nativeChildView?.observation}<p role="status">
              {m.native_review_pending_description()}
            </p>{/if}
          {#if review.nativeChildView?.observation}
            {@render nativeObservationDetails(review.nativeChildView.observation)}
            {#if review.nativeChildView.observation.uncertain}<p role="status">
                {m.native_review_uncertain_description()}
              </p>{/if}
            {#if review.nativeChildView.observation.uncertain || review.nativeChildView.observation.execute?.state === 'pending'}<Button
                onclick={() => review.nativeChild && review.checkNative(review.nativeChild)}
                disabled={!!review.nativeChecking}>{m.repository_selection_check_label()}</Button
              >{/if}
          {/if}
        {/if}
      {/if}
    {:else if review.nativeDemand && review.nativeRead.view?.status !== 'loading' && !review.nativeRead.canChooseRepository}<p
        role="status"
      >
        {m.native_review_unavailable_description()}
      </p>{/if}
    <Button
      variant="ghost"
      onclick={() => {
        review.closeNative();
        appStore.dispatch(setPRWorkflowDrawer(review.props.workspaceId, 'prDrawerOpen', false));
      }}>{m.workspace_prCreator_cancel_label()}</Button
    >
  </section>
{/snippet}

{#if entry}
  {#if review.props.nativeReview && review.nativeEnabled && (review.props.isOwner || (!review.props.listOnly && review.props.admittedGuest)) && !review.hostContext}
    <p role="status">{m.native_review_unavailable_description()}</p>
  {/if}

  <!-- A qualified native entry is independent of the legacy origin-only status. -->
  {#if review.nativeEntryWithoutOrigin && review.props.canHostOperations}
    {#if (!review.nativeDemand || review.nativeRead.target?.provider === 'gitlab' || (review.props.prDrawerOpen && review.nativeMode)) && (review.nativeIntent || (!review.props.hasOpenPR && !(review.props.isMergedToTrunk || (review.props.areAllPRsMerged && !review.props.hasResetToTrunk) || review.props.isContentMergedToTrunk)) || (!review.props.hasOpenPR && review.props.hasNewWorkAfterMerge))}
      <TimelineDivider>
        <DividerButton
          data-testid="pr-create-button"
          tooltipContents={!review.props.hasStaged && !review.props.hasCommits
            ? m.workspace_prSection_noChangesForPr_tooltip()
            : ''}
          onclick={review.togglePRDrawer}
          expanded={review.props.prDrawerOpen}
          disabled={!review.nativeIntent && !review.props.hasStaged && !review.props.hasCommits}
          >{m.workspace_prSection_createPr_label()}</DividerButton
        >
        <DividerPanel open={review.props.prDrawerOpen}>
          {@render nativeReviewForm()}
        </DividerPanel>
      </TimelineDivider>
    {:else if review.nativeRead.view?.status === 'loading'}
      <p role="status">{m.repository_details_loading_description()}</p>
    {:else if review.nativeRead.target?.provider !== 'github'}
      <p role="status">{m.native_review_unavailable_description()}</p>
    {/if}
  {/if}
{:else}
  {@render nativeReviewForm()}
{/if}
