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

  import { fly } from "svelte/transition";
  import {
  faArrowsRotate,
  faCakeCandles,
  faDownload,
  faRotateRight,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  import {
  selectAutoUpdateStatus,
  selectAutoUpdateProgress,
  selectAutoUpdateInfo,
  selectAutoUpdateCurrentVersion,
  selectAutoUpdateError,
} from '$store/renderer/slices/auto-update/auto-update-selectors';
  import { installUpdate } from '$store/renderer/slices/auto-update/auto-update-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    /** Callback when toast should be dismissed */
    onDismiss?: () => void;
    /** Provided automatically by Sonner for custom toast components */
    closeToast?: () => void;
  }

  let { onDismiss, closeToast }: Props = $props();

  function handleClose() {
    onDismiss?.();
    closeToast?.();
  }

  const status$ = selectAutoUpdateStatus();
  const progress$ = selectAutoUpdateProgress();
  const updateInfo$ = selectAutoUpdateInfo();
  const currentVersion$ = selectAutoUpdateCurrentVersion();
  const error$ = selectAutoUpdateError();

  // Derived state from selectors
  let progressPercent = $derived($progress$ ? Math.round($progress$.percent) : 0);

  // Format bytes per second
  function formatSpeed(bytesPerSecond: number): string {
    if (bytesPerSecond >= 1024 * 1024) {
      return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
    }
    if (bytesPerSecond >= 1024) {
      return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
    }
    return `${bytesPerSecond} B/s`;
  }

  function handleInstall() {
    appStore.dispatch(installUpdate());
  }

  // Auto-dismiss when up-to-date or error after a delay
  $effect(() => {
    if (($status$ === 'not-available' || $status$ === 'error') && onDismiss) {
      const delay = $status$ === 'error' ? 5000 : 3000; // Longer for errors so user can read
      const timeout = setTimeout(() => {
        onDismiss();
      }, delay);
      return () => clearTimeout(timeout);
    }
  });
</script>

<div class="update-toast">
  {#if $status$ === 'downloaded' || $status$ === 'downloading' || $status$ === 'error'}
    <button class="close-btn" onclick={handleClose} aria-label="Close">
      <Fa icon={faXmark} size="xs" />
    </button>
  {/if}
  {#if $status$ === 'checking'}
    <div class="flex items-center gap-3">
      <div class="icon checking">
        <Fa icon={faArrowsRotate} class="animate-spin" />
      </div>
      <div class="text">
        <div class="title">Checking for updates...</div>
      </div>
    </div>
  {:else if $status$ === 'available'}
    <div class="flex items-center gap-3">
      <div class="icon downloading">
        <Fa icon={faDownload} class="animate-pulse" />
      </div>
      <div class="text">
        <div class="title">Update {$updateInfo$?.version || ''} available</div>
        <div class="description">Preparing download...</div>
      </div>
    </div>
  {:else if $status$ === 'downloading'}
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-3">
        <div class="icon downloading">
          <Fa icon={faDownload} />
        </div>
        <div class="text flex-1">
          <div class="title">Downloading update {$updateInfo$?.version || ''}</div>
          <div class="description">
            {progressPercent}%{$progress$ ? ` · ${formatSpeed($progress$.bytesPerSecond)}` : ''}
          </div>
        </div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {progressPercent}%"></div>
      </div>
    </div>
  {:else if $status$ === 'downloaded'}
    <div class="flex items-center gap-3">
      <div class="icon-celebrate" transition:fly={{y: 30, duration: 300}}>
        <Fa icon={faCakeCandles} size="2x" />
      </div>
      <div class="text flex-1">
        <div class="title">Update Ready</div>
        <div class="description">
          Version {$updateInfo$?.version} is ready to install
        </div>
      </div>
      <button class="action-btn success" onclick={handleInstall}>
        <Fa icon={faRotateRight} class="mr-1" />
        Install
      </button>
    </div>
  {:else if $status$ === 'not-available'}
    <div class="flex items-center gap-3">
      <div class="icon-celebrate">
        <Fa icon={faCakeCandles} size="2x" />
      </div>
      <div class="text">
        <div class="title">You're up to date</div>
        <div class="description">
          Running version {$currentVersion$}
        </div>
      </div>
    </div>
  {:else if $status$ === 'error'}
    <div class="flex items-center gap-3">
      <div class="icon error">
        <Fa icon={faTriangleExclamation} />
      </div>
      <div class="text flex-1">
        <div class="title">Update check failed</div>
        <div class="description">
          {$error$ || 'An unknown error occurred'}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .update-toast {
    min-width: 280px;
    position: relative;
    overflow: visible;
  }

  .close-btn {
    position: absolute;
    top: -1rem;
    left: -1.25rem;
    transform: translate(-35%, -35%);
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--card));
    color: hsl(var(--muted-foreground));
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: opacity 0.15s ease;
    z-index: 1;
  }

  .close-btn:hover {
    opacity: 0.8;
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
    color: hsl(var(--primary));
  }

  .icon.downloading {
    background: hsl(217 91% 60% / 0.1);
    color: hsl(217 91% 60%);
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
    font-weight: 600;
    font-size: 0.875rem;
    color: hsl(var(--foreground));
  }

  .description {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    margin-top: 0.125rem;
  }

  .progress-bar {
    height: 4px;
    background: hsl(var(--muted));
    border-radius: 0;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: hsl(217 91% 60%);
    border-radius: 0;
    transition: width 0.2s ease;
  }

  .action-btn {
    padding: 0.375rem 0.75rem;
    border-radius: 0;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .action-btn.success {
    background: hsl(142 76% 36%);
    color: white;
  }

  .action-btn.success:hover {
    background: hsl(142 76% 30%);
  }

</style>
