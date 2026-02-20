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

  import { autoUpdateStore } from '$features/auto-update/auto-update.store.svelte';
  import UpdateToast from '$lib/components/ui/toast/UpdateToast.svelte';
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';

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
      componentProps: {
        onDismiss: () => {
          // When update is downloaded, toast is non-dismissible — user must click Install
          if (autoUpdateStore.status === 'downloaded') return;
          if (currentToastId !== undefined) {
            toast.dismiss(currentToastId);
            currentToastId = undefined;
          }
          autoUpdateStore.hideToast();
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
    if (autoUpdateStore.toastVisible && currentToastId === undefined) {
      showUpdateToast();
    }
  });

  // ALWAYS show toast when downloading or downloaded - this is the most important state
  $effect(() => {
    const status = autoUpdateStore.status;

    // Don't react if status hasn't changed
    if (status === previousStatus) return;

    // ALWAYS show toast for downloading or downloaded states
    // This ensures the user always sees download progress and the install button
    if (status === 'downloading' || status === 'downloaded') {
      if (currentToastId === undefined) {
        showUpdateToast();
      }
      // Also ensure toastVisible is true so the toast stays visible
      if (!autoUpdateStore.toastVisible) {
        autoUpdateStore.showToast();
      }
    }

    // Auto-dismiss toast when idle (error is handled by UpdateToast with a delay)
    if (status === 'idle') {
      dismissToast();
      autoUpdateStore.hideToast();
    }

    previousStatus = status;
  });

  // Dismiss toast when not-available or error after a delay (handled by UpdateToast component)
  $effect(() => {
    const status = autoUpdateStore.status;
    if (status === 'not-available' || status === 'error') {
      // Longer delay for errors so user can read the message
      const delay = status === 'error' ? 5500 : 3500;
      const timeout = setTimeout(() => {
        dismissToast();
        autoUpdateStore.hideToast();
      }, delay);
      return () => clearTimeout(timeout);
    }
  });

  onMount(() => {
    // Initialize the auto-update store
    autoUpdateStore.initialize();

    return () => {
      autoUpdateStore.cleanup();
      dismissToast();
    };
  });
</script>

<!-- This component manages toasts, no visible UI of its own -->
