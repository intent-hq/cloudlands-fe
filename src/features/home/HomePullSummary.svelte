<script lang="ts">
  import * as Accordion from '$lib/components/ui/accordion';
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
  import { formatInteger } from '$lib/i18n/format';
  import type {
    HomeIntegrationItem,
    HomePullCheck,
    HomePullReviewData,
  } from './home-integrations-types';
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
        color: 'text-warning',
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
        label:
          state === 'cancelled'
            ? m.home_integrations_checks_cancelled()
            : m.home_integrations_checks_failed(),
      };
    return {
      icon: faMinus,
      color: 'text-muted-foreground',
      label: m.home_integrations_checks_neutral(),
    };
  }
  const checkGroups = $derived.by(() => {
    const checks = data?.checks ?? [];
    return [
      {
        id: 'pending',
        label: m.home_integrations_checks_pending(),
        appearance: checkState('pending'),
        checks: checks.filter((check) => check.state === 'pending'),
      },
      {
        id: 'failed',
        label: m.home_integrations_checks_failed_or_cancelled(),
        appearance: checkState('failure'),
        checks: checks.filter((check) => check.state === 'failure' || check.state === 'cancelled'),
      },
      {
        id: 'passed',
        label: m.home_integrations_checks_passed(),
        appearance: checkState('success'),
        checks: checks.filter((check) => check.state === 'success'),
      },
      {
        id: 'neutral',
        label: m.home_integrations_checks_neutral(),
        appearance: checkState('neutral'),
        checks: checks.filter((check) => check.state === 'neutral'),
      },
    ].filter((group) => group.checks.length);
  });
  const checksStatus = $derived(
    data?.checks.some((check) => check.state === 'failure' || check.state === 'cancelled')
      ? 'failure'
      : data?.checks.some((check) => check.state === 'pending')
        ? 'pending'
        : data?.checks.length && data.checks.every((check) => check.state === 'success')
          ? 'success'
          : 'neutral',
  );
  const checksAppearance = $derived(checkState(checksStatus));
  const checksSummary = $derived(
    checksStatus === 'failure'
      ? m.home_integrations_checks_overall_failed()
      : checksStatus === 'pending'
        ? m.home_integrations_checks_overall_pending()
        : checksStatus === 'success'
          ? m.home_integrations_checks_overall_passed()
          : m.home_integrations_checks_overall_neutral(),
  );
</script>

<div class="min-w-0 space-y-6">
  {#if reviewsError !== m.home_integrations_read_upgrade() || data?.reviews.length || data?.requestedReviewers.length}
    <section class="space-y-2 border-b border-border pb-4">
      <h3 class="text-sm font-medium">{m.home_integrations_reviewers()}</h3>
      {#if reviewsLoading}<HomeLoading rows="compact" count={1} />
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
  <section class="min-w-0 space-y-2 border-b border-border pb-4" data-home-pr-checks>
    {#if checksLoading}<HomeLoading rows="compact" count={1} />{/if}
    {#if checksError === m.home_integrations_read_upgrade() || reviewsError === m.home_integrations_read_upgrade()}
      <p role="status" class="type-body text-muted-foreground">
        {m.home_integrations_read_upgrade()}
      </p>
    {/if}
    {#if checksError && checksError !== m.home_integrations_read_upgrade()}
      <p role="alert" class="type-body text-muted-foreground">{checksError}</p>
      <Button size="sm" disabled={retryDisabled} onclick={retryChecks}
        >{m.home_integrations_retry()}</Button
      >
    {/if}
    {#if checkGroups.length}
      {#key detail.id}
        <Accordion.Root>
          <Accordion.Item value="checks">
            <Accordion.Header>
              <Accordion.Trigger
                class="type-body font-normal text-foreground data-[state=open]:font-normal"
                data-home-pr-checks-summary
              >
                <span class="flex items-start gap-2">
                  <span
                    class="first-line-icon shrink-0 {checksAppearance.color}"
                    aria-hidden="true"
                  >
                    <Fa icon={checksAppearance.icon} />
                  </span>
                  <span class="sr-only">{checksSummary}. </span>
                  <span class="min-w-0 flex-1 flex flex-wrap gap-x-2 text-muted-foreground">
                    {#each checkGroups as group (group.id)}
                      <span>{formatInteger(group.checks.length)} {group.label}</span>
                    {/each}
                  </span>
                </span>
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content inset={false}>
              <Accordion.Root type="multiple" value={['pending', 'failed', 'passed', 'neutral']}>
                {#each checkGroups as group (group.id)}
                  <Accordion.Item value={group.id} data-home-pr-check-group={group.id}>
                    <Accordion.Header level={4}>
                      <Accordion.Trigger
                        class="type-body font-normal text-foreground data-[state=open]:font-normal"
                      >
                        <span class="flex items-start gap-2">
                          <span
                            class="first-line-icon shrink-0 {group.appearance.color}"
                            aria-hidden="true"
                          >
                            <Fa icon={group.appearance.icon} />
                          </span>
                          <span class="min-w-0 flex-1">{group.label}</span>
                          <span class="shrink-0 text-muted-foreground"
                            >{formatInteger(group.checks.length)}</span
                          >
                        </span>
                      </Accordion.Trigger>
                    </Accordion.Header>
                    <Accordion.Content inset={false}>
                      <div class="ml-6 space-y-0.5">
                        {#each group.checks as check, index (check.name + check.url + index)}
                          {@const appearance = checkState(check.state)}
                          {#if check.url}
                            <Button
                              variant="ghost"
                              size="sm"
                              wrapContent={false}
                              class="h-auto min-h-8 w-full items-start justify-start gap-2 whitespace-normal px-2 py-1.5 type-body text-left"
                              onclick={(event) => open(check.url!, event)}
                            >
                              {@render checkLabel(check, appearance)}
                            </Button>
                          {:else}
                            <div
                              class="flex items-start gap-2 px-2 py-1.5 type-body text-foreground"
                            >
                              {@render checkLabel(check, appearance)}
                            </div>
                          {/if}
                        {/each}
                      </div>
                    </Accordion.Content>
                  </Accordion.Item>
                {/each}
              </Accordion.Root>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
      {/key}
    {:else if !checksLoading && !checksError}
      <p class="type-body text-muted-foreground">{m.home_integrations_no_checks()}</p>
    {/if}
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

{#snippet checkLabel(check: HomePullCheck, appearance: ReturnType<typeof checkState>)}
  <span class="first-line-icon shrink-0 {appearance.color}" aria-hidden="true">
    <Fa icon={appearance.icon} />
  </span>
  <span class="min-w-0 flex-1 break-words">
    {check.name}
    <span class="sr-only"> — {appearance.label}</span>
  </span>
  {#if check.state === 'cancelled'}
    <span class="shrink-0 text-muted-foreground" aria-hidden="true">{appearance.label}</span>
  {/if}
{/snippet}
