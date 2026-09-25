<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { UpdateStatus } from '$features/auto-update/types';

  interface Props {
    status?:
      | UpdateStatus
      | 'standard'
      | 'plain'
      | 'undo'
      | 'multiline-warning'
      | 'details'
      | 'multiline-details';
    stacked?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'toast-header',
    title: 'Toast header alignment',
    defaultState: 'downloaded',
    states: {
      downloaded: { props: { status: 'downloaded' } },
      available: { props: { status: 'available' } },
      downloading: { props: { status: 'downloading' } },
      error: { props: { status: 'error' } },
      standard: { props: { status: 'standard' } },
      plain: { props: { status: 'plain' } },
      undo: { props: { status: 'undo' } },
      stacked: { props: { status: 'plain', stacked: true } },
      'multiline-warning': { props: { status: 'multiline-warning' } },
      details: { props: { status: 'details' } },
      'multiline-details': { props: { status: 'multiline-details' } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Toast, ToastUndoAction, UpdateToast, toast } from '$lib/components/ui/toast';
  import { Button } from '$lib/components/ui/button';
  import { notify } from '$lib/components/patterns/notify';
  import { m } from '$shared/paraglide/messages.js';

  let { status = 'downloaded', stacked = false }: Props = $props();
  let actions = $state(0);
  let dismissals = $state(0);
  const toasterId = 'toast-header-preview';
  const id = 'toast-header-fixture';
  const rearId = 'toast-header-rear';
  function close() {
    dismissals += 1;
    toast.dismiss(id);
  }
  function show() {
    const options = { id, toasterId, duration: Number.POSITIVE_INFINITY };
    if (status === 'multiline-warning') {
      notify.warning(m.daemonStatus_versionMismatch_warning({ version: ' (fixture)' }), options);
    } else if (status === 'details' || status === 'multiline-details') {
      notify.error(
        {
          message:
            status === 'details'
              ? 'Request failed'
              : 'Request failed while loading the fixture workspace and its recent activity',
          details: 'Fixture diagnostic only\nRequest: preview-load\nResult: unavailable',
        },
        options,
      );
    } else if (status === 'undo') {
      toast.warning('Workspace archived', { ...options, action: ToastUndoAction });
    } else if (status === 'standard' || status === 'plain') {
      const showStandard = status === 'plain' ? toast : toast.success;
      showStandard('Workspace saved', {
        ...options,
        description:
          'Your workspace changes are safe. Continue working while the fixture stays open.',
        action: { label: 'Review', onClick: () => (actions += 1) },
        cancel:
          status === 'plain' ? { label: 'Later', onClick: () => (dismissals += 1) } : undefined,
        onDismiss: () => (dismissals += 1),
      });
    } else {
      toast.custom(UpdateToast, {
        ...options,
        componentProps: {
          previewState: {
            status,
            updateInfo: {
              version: '4.2.0-alpha.20260916',
              releaseDate: '2026-09-16',
              releaseNotes: 'Fixture only',
            },
            progress: {
              percent: 62,
              bytesPerSecond: 2400000,
              transferred: 62000000,
              total: 95600000,
            },
            remainingSeconds: 14,
            error: 'The fixture could not reach the update server. Please try again later.',
            onInstall: () => (actions += 1),
            onDownload: () => (actions += 1),
          },
          onDismiss: close,
          onAutoDismiss: () => undefined,
        },
      });
    }
  }
  onMount(() => {
    if (stacked) {
      toast.info('Earlier notification', {
        id: rearId,
        toasterId,
        duration: Number.POSITIVE_INFINITY,
        description:
          'This longer notification must hide its copy while collapsed behind the header fixture.',
      });
    }
    show();
    return () => {
      toast.dismiss(id);
      toast.dismiss(rearId);
    };
  });
</script>

<div class="min-h-64 p-4">
  <Button onclick={show}>Show fixture toast</Button>
  <output data-testid="toast-header-actions" class="sr-only">{actions}</output>
  <output data-testid="toast-header-dismissals" class="sr-only">{dismissals}</output>
  <Toast {toasterId} />
</div>
