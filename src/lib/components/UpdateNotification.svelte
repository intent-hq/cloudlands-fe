<script lang="ts">
  /**
   * UpdateNotification - Manages update toast notifications
   *
   * Shows a toast automatically when:
   * - User manually checks for updates (via toastVisible)
   * - An update is available/downloading/downloaded
   *
   * The toast shows progress during download and an install button when ready.
   */

  import UpdateToast from '$lib/components/ui/toast/UpdateToast.svelte';
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import {
  selectAutoUpdateToastVisible,
  selectAutoUpdateStatus,
  selectAutoUpdateDismissedAt,
} from '$lib/store/slices/auto-update/auto-update-selectors';
  import {
  hideToast,
  showToast,
  dismissDownloadedToast,
  initAutoUpdate,
} from '$lib/store/slices/auto-update/auto-update-slice';

  const dispatch = getDispatch();
  const toastVisible$ = selectAutoUpdateToastVisible();
  const status$ = selectAutoUpdateStatus();
  const dismissedAt$ = selectAutoUpdateDismissedAt();

  // 24 hours in milliseconds
  const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

  let currentToastId: string | number | undefined;
  let previousStatus: string | undefined;

  function showUpdateToast() {
    // Dismiss any existing update toast first
    if (currentToastId !== undefined) {
      toast.dismiss(currentToastId);
    }

    // Show the update toast with custom component
    currentToastId = toast.custom(UpdateToast, {
      duration: Infinity, // Don't auto-dismiss for progress states
      onDismiss: () => {
        // Sonner's built-in dismiss (swipe, programmatic)
        currentToastId = undefined;
        const currentStatus = selectAutoUpdateStatus.select(getReduxStore().getState());
        if (currentStatus === 'downloaded') {
          // Allow dismissal but track the time so we can re-prompt after 24h
          dispatch(dismissDownloadedToast(Date.now()));
          return;
        }
        dispatch(hideToast());
      },
      componentProps: {
        onDismiss: () => {
          // Used by UpdateToast's auto-dismiss $effect for not-available/error states
          if (currentToastId !== undefined) {
            toast.dismiss(currentToastId);
            currentToastId = undefined;
          }
          dispatch(hideToast());
        },
      },
    });
  }

  function dismissToast() {
    if (currentToastId !== undefined) {
      toast.dismiss(currentToastId);
      currentToastId = undefined;
    }
  }

  // Show toast when toastVisible becomes true (manual check)
  $effect(() => {
    if ($toastVisible$ && currentToastId === undefined) {
      showUpdateToast();
    }
  });

  // ALWAYS show toast when downloading or downloaded - this is the most important state
  $effect(() => {
    const status = $status$;

    // Don't react if status hasn't changed
    if (status === previousStatus) return;

    // ALWAYS show toast for downloading states
    // For downloaded: respect the 24h dismiss cooldown
    if (status === 'downloading') {
      if (currentToastId === undefined) {
        showUpdateToast();
      }
      // Also ensure toastVisible is true so the toast stays visible
      const isToastVisible = selectAutoUpdateToastVisible.select(getReduxStore().getState());
      if (!isToastVisible) {
        dispatch(showToast());
      }
    } else if (status === 'downloaded') {
      const dismissedAt = selectAutoUpdateDismissedAt.select(getReduxStore().getState());
      const cooldownExpired =
        dismissedAt == null || Date.now() - dismissedAt >= DISMISS_COOLDOWN_MS;

      if (cooldownExpired) {
        if (currentToastId === undefined) {
          showUpdateToast();
        }
        const isToastVisible = selectAutoUpdateToastVisible.select(getReduxStore().getState());
        if (!isToastVisible) {
          dispatch(showToast());
        }
      } else {
        // Cooldown still active — dismiss the toast if it's showing
        // (e.g., user triggered "Check for Updates" which briefly showed the checking toast)
        dismissToast();
        dispatch(hideToast());
      }
    }

    // Auto-dismiss toast when idle (error is handled by UpdateToast with a delay)
    if (status === 'idle') {
      dismissToast();
      dispatch(hideToast());
    }

    previousStatus = status;
  });

  // Re-show "downloaded" toast after the 24h cooldown expires
  $effect(() => {
    const status = $status$;
    const dismissedAt = $dismissedAt$;

    if (status !== 'downloaded' || dismissedAt == null) return;

    const elapsed = Date.now() - dismissedAt;
    const remaining = DISMISS_COOLDOWN_MS - elapsed;

    if (remaining <= 0) return; // Already expired — the status effect above handles it

    const timeout = setTimeout(() => {
      // Re-show the toast now that cooldown has expired
      const currentStatus = selectAutoUpdateStatus.select(getReduxStore().getState());
      if (currentStatus === 'downloaded') {
        showUpdateToast();
        dispatch(showToast());
      }
    }, remaining);

    return () => clearTimeout(timeout);
  });

  // Dismiss toast when not-available or error after a delay (handled by UpdateToast component)
  $effect(() => {
    const status = $status$;
    if (status === 'not-available' || status === 'error') {
      // Longer delay for errors so user can read the message
      const delay = status === 'error' ? 5500 : 3500;
      const timeout = setTimeout(() => {
        dismissToast();
        dispatch(hideToast());
      }, delay);
      return () => clearTimeout(timeout);
    }
  });

  onMount(() => {
    // Initialize the auto-update store via saga
    dispatch(initAutoUpdate());

    return () => {
      dismissToast();
    };
  });
</script>

<!-- This component manages toasts, no visible UI of its own -->
