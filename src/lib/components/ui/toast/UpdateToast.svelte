<script lang="ts">
  /**
   * UpdateToast - Toast component for showing update status
   *
   * Shows different states:
   * - Checking: Spinner with "Checking for updates..."
   * - Downloading: Progress bar with download percentage
   * - Downloaded: Install button with version info
   * - Up to date: Success message (brief)
   */

  import { untrack } from 'svelte';
  import { crispOut, springIn } from '$lib/motion';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import {
    faCakeCandles,
    faRotateRight,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { readable } from 'svelte/store';

  import {
    selectAutoUpdateStatus,
    selectAutoUpdateProgress,
    selectAutoUpdateInfo,
    selectAutoUpdateCurrentVersion,
    selectAutoUpdateError,
  } from '$store/renderer/slices/auto-update/auto-update-selectors';
  import {
    downloadUpdate,
    installUpdate,
  } from '$store/renderer/slices/auto-update/auto-update-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { formatNumber, formatInteger } from '$lib/i18n/format';
  import ToastCloseButton from './ToastCloseButton.svelte';
  import ToastGlyph from './ToastGlyph.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { UpdateInfo, UpdateProgress, UpdateStatus } from '$features/auto-update/types';

  interface PreviewState {
    status: UpdateStatus;
    updateInfo?: UpdateInfo | null;
    progress?: UpdateProgress | null;
    currentVersion?: string;
    error?: string | null;
    availableDescription?: string;
    remainingSeconds?: number;
  }

  interface Props {
    /** Callback when toast should be dismissed */
    onDismiss?: () => void;
    /** Programmatic auto-dismiss (not-available/error delay) — falls back to onDismiss */
    onAutoDismiss?: () => void;
    /** Provided automatically by Sonner for custom toast components */
    closeToast?: () => void;
    /** Deterministic presentational state for catalogs and tests. */
    previewState?: PreviewState;
  }

  let { onDismiss, onAutoDismiss, closeToast, previewState }: Props = $props();

  function handleClose() {
    onDismiss?.();
    closeToast?.();
  }

  const initialPreviewState = untrack(() => previewState);
  const status$ = initialPreviewState
    ? readable(initialPreviewState.status)
    : selectAutoUpdateStatus();
  const progress$ = initialPreviewState
    ? readable(initialPreviewState.progress ?? null)
    : selectAutoUpdateProgress();
  const updateInfo$ = initialPreviewState
    ? readable(initialPreviewState.updateInfo ?? null)
    : selectAutoUpdateInfo();
  const currentVersion$ = initialPreviewState
    ? readable(initialPreviewState.currentVersion ?? '')
    : selectAutoUpdateCurrentVersion();
  const error$ = initialPreviewState
    ? readable(initialPreviewState.error ?? null)
    : selectAutoUpdateError();

  let status = $derived(previewState?.status ?? $status$);
  let progress = $derived(previewState?.progress ?? $progress$);
  let updateInfo = $derived(previewState?.updateInfo ?? $updateInfo$);
  let currentVersion = $derived(previewState?.currentVersion ?? $currentVersion$);
  let updateError = $derived(previewState?.error ?? $error$);
  let progressPercent = $derived(progress ? Math.round(progress.percent) : 0);
  let remainingSeconds = $derived(
    previewState?.remainingSeconds ??
      (progress && progress.bytesPerSecond > 0
        ? Math.max(0, Math.ceil((progress.total - progress.transferred) / progress.bytesPerSecond))
        : null),
  );

  // Format bytes per second
  function formatSpeed(bytesPerSecond: number): string {
    if (bytesPerSecond >= 1024 * 1024) {
      return m.ui_updateToast_speedMbps_label({
        speed: formatNumber(bytesPerSecond / (1024 * 1024), {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      });
    }
    if (bytesPerSecond >= 1024) {
      return m.ui_updateToast_speedKbps_label({ speed: formatInteger(bytesPerSecond / 1024) });
    }
    return m.ui_updateToast_speedBps_label({ speed: formatInteger(bytesPerSecond) });
  }

  function handleInstall() {
    appStore.dispatch(installUpdate());
  }

  function handleDownload() {
    appStore.dispatch(downloadUpdate());
  }

  // Auto-dismiss when up-to-date or error after a delay
  $effect(() => {
    const autoDismiss = onAutoDismiss ?? onDismiss;
    if ((status === 'not-available' || status === 'error') && autoDismiss) {
      const delay = status === 'error' ? 5000 : 3000; // Longer for errors so user can read
      const timeout = setTimeout(() => {
        autoDismiss();
      }, delay);
      return () => clearTimeout(timeout);
    }
  });
</script>

<div
  class="update-toast"
  class:has-close={status === 'downloaded' || status === 'downloading' || status === 'error'}
>
  {#if status === 'downloaded' || status === 'downloading' || status === 'error'}
    <ToastCloseButton onclick={handleClose} ariaLabel={m.ui_updateToast_close_ariaLabel()} />
  {/if}
  {#if status === 'checking'}
    <div class="toast-row">
      <div class="icon checking">
        <IntentMarkLoader size={16} />
      </div>
      <div class="text">
        <div class="title">{m.ui_updateToast_checking_label()}</div>
      </div>
    </div>
  {:else if status === 'available'}
    <div class="toast-row">
      <ToastGlyph variant="update" />
      <div class="text flex-1">
        <div class="title">
          {m.ui_updateToast_available_label({ version: updateInfo?.version || '' })}
        </div>
        <div class="description">
          {previewState?.availableDescription ?? m.ui_updateToast_readyToDownload_description()}
        </div>
      </div>
      <Button
        variant="primary"
        size="default"
        class="toast-action ml-auto"
        onclick={handleDownload}
      >
        {m.ui_updateToast_download_label()}
      </Button>
    </div>
  {:else if status === 'downloading'}
    <div class="toast-downloading">
      <div class="toast-row items-start">
        <ToastGlyph variant="update" />
        <div class="text min-w-0 flex-1">
          <div class="title">
            {m.ui_updateToast_downloading_label({ version: updateInfo?.version || '' })}
          </div>
          <div class="description">
            {#if progress}{formatSpeed(progress.bytesPerSecond)}{/if}{#if remainingSeconds != null}
              · {m.ui_updateToast_remainingSeconds_label({
                seconds: formatInteger(remainingSeconds),
              })}
            {/if}
          </div>
        </div>
        <span class="toast-progress-label">{formatInteger(progressPercent)}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {progressPercent}%"></div>
      </div>
    </div>
  {:else if status === 'downloaded'}
    <div class="toast-row">
      <div
        class="icon-celebrate"
        in:springIn={{ tier: 'slow', y: 30, scale: 1 }}
        out:crispOut={{ tier: 'slow' }}
      >
        <Fa icon={faCakeCandles} size="2x" />
      </div>
      <div class="text flex-1">
        <div class="title">{m.ui_updateToast_updateReady_label()}</div>
        <div class="description">
          {m.ui_updateToast_readyToInstall_description({ version: updateInfo?.version ?? '' })}
        </div>
      </div>
      <Button variant="primary" size="default" class="toast-action" onclick={handleInstall}>
        <Fa icon={faRotateRight} class="mr-1" />
        {m.ui_updateToast_install_label()}
      </Button>
    </div>
  {:else if status === 'not-available'}
    <div class="toast-row">
      <div class="icon-celebrate">
        <Fa icon={faCakeCandles} size="2x" />
      </div>
      <div class="text">
        <div class="title">{m.ui_updateToast_upToDate_label()}</div>
        <div class="description">
          {m.ui_updateToast_runningVersion_description({ version: currentVersion ?? '' })}
        </div>
      </div>
    </div>
  {:else if status === 'error'}
    <div class="toast-row">
      <div class="icon error">
        <Fa icon={faTriangleExclamation} />
      </div>
      <div class="text flex-1">
        <div class="title">{m.ui_updateToast_checkFailed_label()}</div>
        <div class="description">
          {updateError || m.ui_updateToast_unknown_error()}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .update-toast {
    width: 100%;
    min-width: 0;
    position: relative;
    overflow: visible;
  }

  .update-toast.has-close {
    padding-right: 2.5rem;
  }

  .toast-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .toast-downloading {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0;
    flex-shrink: 0;
  }

  .icon.checking {
    background: hsl(var(--primary) / 0.1);
    color: hsl(var(--primary-ink));
  }

  .icon-celebrate {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    color: hsl(var(--muted-foreground) / 0.3);
  }

  .icon.error {
    background: hsl(0 84% 60% / 0.1);
    color: hsl(0 84% 60%);
  }

  .text {
    min-width: 0;
  }

  .title {
    font-weight: 500;
    font-size: 1rem;
    line-height: 1.35;
    color: hsl(var(--foreground));
    overflow-wrap: anywhere;
  }

  .description {
    font-size: 0.9375rem;
    line-height: 1.4;
    color: hsl(var(--muted-foreground));
    margin-top: 0.25rem;
    overflow-wrap: anywhere;
  }

  .progress-bar {
    height: 4px;
    background: hsl(var(--muted));
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-left: 2rem;
  }

  .progress-fill {
    height: 100%;
    background: hsl(var(--ring));
    border-radius: var(--radius-full);
    transition: width var(--spring-moderate) var(--spring-moderate-ease);
  }

  .toast-progress-label {
    color: hsl(var(--muted-foreground));
    font-size: 0.875rem;
    line-height: 1.4;
  }

  :global(.toast-action) {
    border-radius: var(--radius-medium);
  }

  :global(.toast-action:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-fill {
      transition: none;
    }
  }
</style>
