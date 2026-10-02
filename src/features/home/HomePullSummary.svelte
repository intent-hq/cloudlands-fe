<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faCircleCheck,
    faCircleXmark,
    faClock,
    faMinus,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import HomeLoading from './HomeLoading.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { HomeIntegrationItem, HomePullReviewData } from './home-integrations-types';
  let {
    detail,
    data,
    checksLoading,
    checksError,
    reviewsLoading,
    reviewsError,
    open,
    retryChecks,
    retryReviews,
    retryDisabled = false,
  }: {
    retryChecks: () => void;
    retryReviews: () => void;
    retryDisabled?: boolean;
    checksLoading: boolean;
    checksError: string | null;
    reviewsLoading: boolean;
    reviewsError: string | null;
    detail: HomeIntegrationItem;
    data: HomePullReviewData | null;
    open: (url: string, event?: MouseEvent) => void;
  } = $props();
  function verdict(state: string) {
    switch (state.toLowerCase()) {
      case 'approved':
        return m.home_integrations_review_approved();
      case 'changes_requested':
      case 'changes-requested':
        return m.home_integrations_review_changes_requested();
      case 'dismissed':
        return m.home_integrations_review_dismissed();
      case 'pending':
        return m.home_integrations_review_pending();
      default:
        return m.home_integrations_review_commented();
    }
  }
  const latestReviews = $derived([
    ...new Map((data?.reviews ?? []).map((review) => [review.author, review])).values(),
  ]);
  function checkState(state: string) {
    if (state === 'pending')
      return {
        icon: faClock,
        color: 'text-muted-foreground',
        label: m.home_integrations_checks_pending(),
      };
    if (state === 'success')
      return {
        icon: faCircleCheck,
        color: 'text-success',
        label: m.home_integrations_checks_passed(),
      };
    if (state === 'failure' || state === 'cancelled')
      return {
        icon: faCircleXmark,
        color: 'text-danger',
        label: m.home_integrations_checks_failed(),
      };
    return {
      icon: faMinus,
      color: 'text-muted-foreground',
      label: m.home_integrations_checks_neutral(),
    };
  }
</script>

<div class="min-w-0 space-y-6">
  {#if reviewsError !== m.home_integrations_read_upgrade() || data?.reviews.length || data?.requestedReviewers.length}
    <section class="space-y-2 border-b border-border pb-4">
      <h3 class="text-sm font-medium">{m.home_integrations_reviewers()}</h3>
      {#if reviewsLoading}<HomeLoading count={1} />
      {:else if reviewsError && reviewsError !== m.home_integrations_read_upgrade()}
        <p role="alert" class="type-caption text-muted-foreground">{reviewsError}</p>
        <Button size="sm" disabled={retryDisabled} onclick={retryReviews}
          >{m.home_integrations_retry()}</Button
        >
      {/if}
      {#each latestReviews as review (review.author)}
        <div class="flex items-center gap-2 type-caption">
          <GitHubAvatar identity={review.author} size={20} class="rounded-full" />
          <span class="min-w-0 flex-1 truncate">{review.author}</span>
          <span
            class:text-success={review.state.toLowerCase() === 'approved'}
            class:text-danger={review.state.toLowerCase() === 'changes_requested'}
            >{verdict(review.state)}</span
          >
        </div>
      {/each}
      {#each data?.requestedReviewers ?? [] as reviewer (reviewer)}
        <div class="flex items-center gap-2 type-caption text-muted-foreground">
          <GitHubAvatar identity={reviewer} size={20} class="rounded-full" />
          <span class="min-w-0 flex-1 truncate">{reviewer}</span><span
            >{m.home_integrations_review_requested_label()}</span
          >
        </div>
      {/each}
      {#if !reviewsLoading && !reviewsError && !latestReviews.length && !(data?.requestedReviewers ?? []).length}<p
          class="type-caption text-muted-foreground"
        >
          {m.home_integrations_no_reviews()}
        </p>{/if}
    </section>
  {/if}
  <section class="space-y-2 border-b border-border pb-4">
    <h3 class="text-sm font-medium">{m.home_integrations_checks()}</h3>
    {#if checksLoading}<HomeLoading count={1} />{/if}
    {#if checksError === m.home_integrations_read_upgrade() || reviewsError === m.home_integrations_read_upgrade()}
      <p role="status" class="type-caption text-muted-foreground">
        {m.home_integrations_read_upgrade()}
      </p>
    {/if}
    {#if checksError && checksError !== m.home_integrations_read_upgrade()}
      <p role="alert" class="type-caption text-muted-foreground">{checksError}</p>
      <Button size="sm" disabled={retryDisabled} onclick={retryChecks}
        >{m.home_integrations_retry()}</Button
      >
    {/if}
    {#each data?.checks ?? [] as check (check.name + check.url)}
      {@const appearance = checkState(check.state)}
      <div class="flex items-center gap-2 type-caption">
        <span class={appearance.color} title={appearance.label}><Fa icon={appearance.icon} /></span>
        {#if check.url}<Button
            variant="ghost"
            size="sm"
            class="min-w-0 flex-1 truncate text-left hover:underline"
            onclick={(event) => open(check.url!, event)}>{check.name}</Button
          >{:else}<span class="min-w-0 flex-1 truncate">{check.name}</span>{/if}
        <span class="shrink-0 text-muted-foreground">{appearance.label}</span>
      </div>
    {/each}
    {#if !checksLoading && !checksError && !(data?.checks ?? []).length}<p
        class="type-caption text-muted-foreground"
      >
        {m.home_integrations_no_checks()}
      </p>{/if}
  </section>
  <section class="min-w-0 space-y-3">
    {#if detail.description}
      <MarkdownViewer
        content={detail.description}
        allowSanitizedHtml
        allowFileMedia={false}
        canOpenFile={() => false}
        renderRichFencesAsCode
      />
    {:else}<p class="text-sm text-muted-foreground">{m.home_integrations_no_description()}</p>{/if}
  </section>
</div>
