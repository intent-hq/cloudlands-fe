<script lang="ts">
  import { faFolderOpen, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import {
    EmptyState,
    ErrorState,
    LoadingState,
    Screen,
    ScreenBody,
    ScreenFooter,
    ScreenHeader,
    TakeoverScreen,
  } from '$lib/components/patterns/screen';
  import NotifyErrorToast from '$lib/components/patterns/notify/NotifyErrorToast.svelte';
  import MediaUnavailable from '$lib/components/ui/MediaUnavailable.svelte';
  import SizeProvider from '$lib/components/ui/SizeProvider.svelte';
  import { Button } from '$lib/components/ui/button';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import type { CatalogRendererProps } from '../catalog-renderers';
  import ScreenPreviewCell from './ScreenPreviewCell.svelte';

  let { fixture }: CatalogRendererProps = $props();
  const noOp = () => undefined;
</script>

{#snippet inboxIcon()}<Fa icon={faFolderOpen} class="size-6" />{/snippet}
{#snippet warningIcon()}<Fa icon={faTriangleExclamation} class="size-6" />{/snippet}
{#snippet pageTitle()}<h3 class="type-title font-semibold">Workspace setup</h3>{/snippet}
{#snippet pageDescription()}<p>Review the repository before continuing.</p>{/snippet}
{#snippet pageBody()}
  <div class="grid gap-3 p-5"><Skeleton class="h-3 w-3/4" /><Skeleton class="h-20 w-full" /></div>
{/snippet}
{#snippet secondaryAction()}<Button variant="outline">Back</Button>{/snippet}
{#snippet primaryAction()}<Button>Continue</Button>{/snippet}
{#snippet emptyTitle()}<h3>No workspaces yet</h3>{/snippet}
{#snippet emptyShort()}<p>Create a workspace to begin.</p>{/snippet}
{#snippet emptyLong()}
  <p>
    A workspace keeps repository context, conversations, tasks, and review evidence together so the
    next handoff stays easy to understand.
  </p>
{/snippet}
{#snippet emptyActions()}<Button variant="outline">Learn more</Button><Button
    >Create workspace</Button
  >{/snippet}
{#snippet errorShort()}<p>We could not load this screen.</p>{/snippet}
{#snippet errorLong()}
  <p>
    The daemon did not return the requested workspace. Check the connection and try again; your
    local changes remain safe.
  </p>
{/snippet}
{#snippet errorDetails()}<p>JSON-RPC request timed out after 30 seconds.</p>{/snippet}
{#snippet takeoverCounter()}<span class="type-caption text-muted-foreground">2 of 3</span>{/snippet}

<div
  class="screen-states-matrix"
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state={fixture.states.join(' ')}
>
  <section class="state-family" aria-labelledby="screen-composition-family">
    <h3 id="screen-composition-family" class="family-title">Screen composition</h3>
    <div class="preview-grid">
      <ScreenPreviewCell id="screen-composition-full" label="Header, body, footer · full width">
        <Screen class="h-64"
          ><ScreenHeader title={pageTitle} description={pageDescription} /><ScreenBody
            >{@render pageBody()}</ScreenBody
          ><ScreenFooter secondary={secondaryAction} primary={primaryAction} /></Screen
        >
      </ScreenPreviewCell>
      <ScreenPreviewCell
        id="screen-composition-320"
        label="Header, body, footer · 320 px"
        width="320"
      >
        <Screen class="h-64"
          ><ScreenHeader title={pageTitle} description={pageDescription} /><ScreenBody
            >{@render pageBody()}</ScreenBody
          ><ScreenFooter secondary={secondaryAction} primary={primaryAction} /></Screen
        >
      </ScreenPreviewCell>
      <ScreenPreviewCell id="takeover-full" label="Takeover · full width">
        <TakeoverScreen
          title={pageTitle}
          description={pageDescription}
          counter={takeoverCounter}
          secondary={secondaryAction}
          primary={primaryAction}
          class="h-64">{@render pageBody()}</TakeoverScreen
        >
      </ScreenPreviewCell>
      <ScreenPreviewCell id="takeover-320" label="Takeover · 320 px" width="320">
        <TakeoverScreen
          title={pageTitle}
          description={pageDescription}
          counter={takeoverCounter}
          secondary={secondaryAction}
          primary={primaryAction}
          class="h-64">{@render pageBody()}</TakeoverScreen
        >
      </ScreenPreviewCell>
    </div>
  </section>

  <section class="state-family" aria-labelledby="empty-state-family">
    <h3 id="empty-state-family" class="family-title">Blank and error states</h3>
    <div class="preview-grid">
      <ScreenPreviewCell id="empty-short-no-icon" label="Empty · short copy · no icon">
        <EmptyState
          title={emptyTitle}
          description={emptyShort}
          actionLabel="Create workspace"
          onAction={noOp}
        />
      </ScreenPreviewCell>
      <ScreenPreviewCell
        id="empty-long-icon-actions-320"
        label="Empty · long copy · icon · two actions · 320 px"
        width="320"
      >
        <EmptyState
          title={emptyTitle}
          description={emptyLong}
          icon={inboxIcon}
          actions={emptyActions}
          emphasis="prominent"
        />
      </ScreenPreviewCell>
      <ScreenPreviewCell id="empty-compact-no-action" label="Empty · compact · no action">
        <SizeProvider size="compact"
          ><EmptyState
            title={emptyTitle}
            description={emptyShort}
            density="compact"
          /></SizeProvider
        >
      </ScreenPreviewCell>
      <ScreenPreviewCell id="error-routine-retry" label="Error · routine · retry">
        <ErrorState message={errorShort} retryLabel="Retry" onRetry={noOp} />
      </ScreenPreviewCell>
      <ScreenPreviewCell
        id="error-danger-details-320"
        label="Error · danger · icon · details · 320 px"
        width="320"
      >
        <ErrorState
          message={errorLong}
          retryLabel="Try again"
          onRetry={noOp}
          details={errorDetails}
          detailsLabel="Technical details"
          icon={warningIcon}
          severity="danger"
        />
      </ScreenPreviewCell>
      <ScreenPreviewCell id="error-no-action" label="Error · no action">
        <ErrorState message={errorShort} />
      </ScreenPreviewCell>
    </div>
  </section>

  <section class="state-family" aria-labelledby="loading-state-family">
    <h3 id="loading-state-family" class="family-title">Loading and skeleton states</h3>
    <div class="preview-grid">
      <ScreenPreviewCell id="loading-list-full" label="LoadingState · list · full width"
        ><div class="p-4">
          <LoadingState label="Loading workspaces" recipe="list" count={4} />
        </div></ScreenPreviewCell
      >
      <ScreenPreviewCell
        id="loading-card-grid-320"
        label="LoadingState · cards · 320 px"
        width="320"
        ><div class="p-4">
          <LoadingState label="Loading cards" recipe="card-grid" count={4} />
        </div></ScreenPreviewCell
      >
      <ScreenPreviewCell id="loading-form-compact" label="LoadingState · compact form"
        ><SizeProvider size="compact"
          ><div class="p-4">
            <LoadingState label="Loading form" recipe="form" count={2} density="compact" />
          </div></SizeProvider
        ></ScreenPreviewCell
      >
      <ScreenPreviewCell id="loading-indicator" label="LoadingIndicator"
        ><div class="flex min-h-28 items-center justify-center">
          <IntentMarkLoader variant="bloom" size={32} />
        </div></ScreenPreviewCell
      >
      <ScreenPreviewCell id="skeleton-text-avatar" label="Skeleton · text and avatar"
        ><div class="flex gap-3 p-4" role="status" aria-label="Loading profile">
          <Skeleton class="size-10 shrink-0 rounded-full" />
          <div class="grid flex-1 gap-2">
            <Skeleton class="h-3 w-1/2" /><Skeleton class="h-3 w-full" /><Skeleton
              class="h-3 w-3/4"
            />
          </div>
        </div></ScreenPreviewCell
      >
      <ScreenPreviewCell id="skeleton-card-list" label="Skeleton · card and list"
        ><div class="grid gap-3 p-4" role="status" aria-label="Loading cards and list">
          <Skeleton class="h-20 w-full" />{#each Array(3) as _, index (index)}<Skeleton
              class="h-8 w-full"
            />{/each}
        </div></ScreenPreviewCell
      >
      <ScreenPreviewCell
        id="loading-reduced-motion"
        label="Reduced motion · static loader and skeleton"
        ><div class="grid gap-3 p-4" data-reduced-motion>
          <IntentMarkLoader variant="bloom" size={24} playing={false} /><Skeleton
            class="h-3 w-full"
          /><Skeleton class="h-3 w-2/3" />
        </div></ScreenPreviewCell
      >
      <ScreenPreviewCell id="loading-zoom-200" label="Skeleton · 200% zoom" zoom
        ><div class="grid gap-2 p-3" role="status" aria-label="Loading zoomed content">
          <Skeleton class="h-3 w-full" /><Skeleton class="h-10 w-full" />
        </div></ScreenPreviewCell
      >
    </div>
  </section>

  <section class="state-family" aria-labelledby="feedback-state-family">
    <h3 id="feedback-state-family" class="family-title">Notices and unavailable content</h3>
    <div class="preview-grid">
      <ScreenPreviewCell id="notice-banner" label="SidebarCallout · banner"
        ><div class="p-4">
          <Sidebar.SidebarCallout role="status"
            ><strong>Connection restored</strong><span class="type-caption text-muted-foreground"
              >Workspace events are current again.</span
            ></Sidebar.SidebarCallout
          >
        </div></ScreenPreviewCell
      >
      <ScreenPreviewCell id="notice-inline-320" label="SidebarCallout · inline · 320 px" width="320"
        ><div class="p-4">
          <Sidebar.SidebarCallout variant="inline" role="status"
            ><Fa icon={faTriangleExclamation} class="size-4" /><span class="type-caption"
              >This branch is behind main.</span
            ></Sidebar.SidebarCallout
          >
        </div></ScreenPreviewCell
      >
      <ScreenPreviewCell id="input-messages" label="Inline helper and error messages"
        ><div class="p-4">
          <InputMessage>Changes save automatically.</InputMessage><InputMessage tone="error"
            >Choose a repository before continuing.</InputMessage
          >
        </div></ScreenPreviewCell
      >
      <ScreenPreviewCell id="media-unavailable-missing" label="Media unavailable · missing"
        ><div class="p-4">
          <MediaUnavailable name="architecture.png" reason="missing" />
        </div></ScreenPreviewCell
      >
      <ScreenPreviewCell
        id="media-unavailable-actions-320"
        label="Media unavailable · actions · 320 px"
        width="320"
        ><div class="p-4">
          <MediaUnavailable
            name="recording.webm"
            reason="unsupported"
            path="artifacts/recording.webm"
          />
        </div></ScreenPreviewCell
      >
      <ScreenPreviewCell id="notify-error-toast-static" label="NotifyErrorToast · static"
        ><div class="toast-static">
          <NotifyErrorToast
            message="Request failed"
            details={'JSON-RPC -32000\nThe daemon rejected the request.'}
          />
        </div></ScreenPreviewCell
      >
    </div>
  </section>
</div>

<style>
  .screen-states-matrix {
    display: grid;
    min-width: 0;
    gap: var(--space-6);
  }
  .state-family {
    display: grid;
    min-width: 0;
    gap: var(--space-3);
  }
  .family-title {
    font-size: var(--text-body);
    font-weight: var(--text-body-strong-weight);
    color: hsl(var(--foreground));
  }
  .preview-grid {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    align-items: start;
    gap: var(--space-4);
  }
  .toast-static {
    min-width: 0;
    margin: var(--space-4);
    padding: var(--space-3);
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--popover));
    box-shadow: var(--elevation-overlay);
  }
</style>
