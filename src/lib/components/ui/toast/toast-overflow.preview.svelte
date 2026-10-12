<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    scenario?: string;
  }
  const scenarios = [
    'standard',
    'deleted',
    'url-unicode',
    'empty',
    'actions',
    'details',
    'application-error',
    'discussion',
    'blocker',
    'failure',
    'auth',
    'retrying',
    'update-available',
    'update-downloading',
    'update-downloaded',
    'update-error',
    'mixed',
    'burst',
    'keyboard-stack',
  ];
  export const preview = definePreview<Props>({
    id: 'toast-overflow',
    title: 'Toast overflow edge cases',
    defaultState: 'deleted',
    states: Object.fromEntries(scenarios.map((scenario) => [scenario, { props: { scenario } }])),
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import {
    Toast,
    ErrorToast,
    AgentAttentionToast,
    AgentFailureToast,
    UpdateToast,
    toast,
  } from '$lib/components/ui/toast';
  import { notify } from '$lib/components/patterns/notify';
  import type { UpdateStatus } from '$features/auto-update/types';

  let { scenario = 'deleted' }: Props = $props();
  let events = $state<string[]>([]);
  const toasterId = 'toast-overflow-preview';
  const ids = new Set<string>();
  const longText = Array.from(
    { length: 18 },
    (_, i) =>
      `Paragraph ${i + 1}: this deleted chat message contains a full explanation that must stay inside the notification.`,
  ).join('\n');
  const difficultText = `https://example.test/${'long-path'.repeat(40)}\n${'超長い通知'.repeat(50)} 🧑🏽‍💻 مرحبا بالعالم\n${longText}`;
  const diagnostics = Array.from(
    { length: 40 },
    (_, i) => `Diagnostic ${i + 1}: ${difficultText}`,
  ).join('\n');
  const record = (event: string) => {
    events = [...events, event];
  };
  function options(id: string) {
    ids.add(id);
    return { id, toasterId, duration: Number.POSITIVE_INFINITY };
  }
  function show(kind = scenario, id = `overflow-${kind}`) {
    const common = options(id);
    const close = () => {
      record('close');
      toast.dismiss(id);
    };
    if (kind === 'mixed' || kind === 'burst' || kind === 'keyboard-stack') {
      const kinds =
        kind === 'keyboard-stack'
          ? ['short-action', 'update-downloaded', 'deleted']
          : kind === 'mixed'
            ? ['discussion', 'details', 'auth', 'standard', 'update-downloaded', 'deleted']
            : Array.from({ length: 12 }, (_, i) => (i % 2 ? 'standard' : 'deleted'));
      kinds.forEach((type, i) => show(type, `overflow-stack-${i}`));
    } else if (kind === 'details') {
      notify.error({ message: longText, details: diagnostics }, common);
    } else if (kind === 'application-error') {
      toast.custom(ErrorToast, {
        ...common,
        componentProps: {
          error: {
            id,
            type: 'error',
            title: longText,
            message: difficultText,
            recoverable: true,
            timestamp: new Date('2026-10-06T12:00:00Z'),
          },
          onCopy: () => record('copy'),
          onDebug: () => record('debug'),
          onRetry: () => record('retry'),
        },
      });
    } else if (kind === 'discussion' || kind === 'blocker') {
      toast.custom(AgentAttentionToast, {
        ...common,
        componentProps: {
          title: longText,
          reason: difficultText,
          kind,
          keySlot: 2,
          timestamp: '2026-10-06T12:00:00Z',
          onSwitchTo: () => record('switch'),
          onClose: close,
        },
      });
    } else if (['failure', 'auth', 'retrying'].includes(kind)) {
      toast.custom(AgentFailureToast, {
        ...common,
        componentProps: {
          title: longText,
          errorSummary: difficultText,
          contextLine: difficultText,
          keySlot: 2,
          retryLabel: 'Retry the agent with a very long display name',
          retrying: kind === 'retrying',
          retryNote: difficultText,
          loginCommandHint:
            kind === 'auth' ? `claude auth login --fixture=${'x'.repeat(220)}` : undefined,
          showClaudeDesktopNote: kind === 'auth',
          onRetry: () => record('retry'),
          onSwitchTo: () => record('switch'),
          onClose: close,
        },
      });
    } else if (kind.startsWith('update-')) {
      toast.custom(UpdateToast, {
        ...common,
        componentProps: {
          previewState: {
            status: kind.slice(7) as UpdateStatus,
            updateInfo: {
              version: '4.2.0-alpha.20261006',
              releaseDate: '2026-10-06',
              releaseNotes: longText,
            },
            availableDescription: difficultText,
            error: difficultText,
            progress: {
              percent: 62,
              bytesPerSecond: 2400000,
              transferred: 62000000,
              total: 100000000,
            },
            remainingSeconds: 14,
            onInstall: () => record('install'),
            onDownload: () => record('download'),
          },
          onDismiss: close,
          onAutoDismiss: () => undefined,
        },
      });
    } else if (kind === 'short-action') {
      toast.success('Changes saved', {
        ...common,
        action: { label: 'Review', onClick: () => record('review') },
      });
    } else if (kind === 'deleted') {
      toast.warning(`Deleted message: ${longText}`, {
        ...common,
        action: { label: 'Undo', onClick: () => record('undo') },
      });
    } else {
      toast(kind === 'empty' ? '' : kind === 'url-unicode' ? difficultText : longText, {
        ...common,
        description: kind === 'empty' ? undefined : difficultText,
        ...(kind === 'actions'
          ? {
              action: {
                label: 'Review all changes in the workspace before continuing',
                onClick: () => record('action'),
              },
              cancel: {
                label: 'Keep working and remind me about these changes later',
                onClick: () => record('cancel'),
              },
            }
          : {}),
      });
    }
  }
  function reset() {
    ids.forEach((id) => toast.dismiss(id));
  }
  onMount(() => {
    show();
    return reset;
  });
</script>

<div class="min-h-64 p-4" data-testid="toast-overflow-preview" data-scenario={scenario}>
  <div class="flex flex-wrap gap-2">
    <Button onclick={() => show()}>Show fixture again</Button>
    <Button onclick={() => show('mixed')}>Add mixed stack</Button>
    <Button onclick={() => show('burst')}>Add burst</Button>
  </div>
  <output class="sr-only" data-testid="toast-overflow-events">{events.join(',')}</output>
  <Toast {toasterId} regionId="toast-overflow-region" />
</div>
