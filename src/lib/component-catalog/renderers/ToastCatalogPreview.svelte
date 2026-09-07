<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
  import {
    AgentAttentionToast,
    AgentFailureToast,
    ErrorToast,
    type ExternalToast,
    TOAST_COUNTDOWN_CLASS,
    Toast,
    UpdateToast,
    toast,
  } from '$lib/components/ui/toast';
  import { notify } from '$lib/components/patterns/notify';
  import NotifyErrorToast from '$lib/components/patterns/notify/NotifyErrorToast.svelte';
  import type { AppError } from '$lib/utils/error-handler.svelte';

  let { fixture }: { componentId: 'toast'; fixture: UiComponentFixture } = $props();

  const noOp = () => undefined;
  const previewRegions = [
    ['success', 'Sonner success'],
    ['error', 'Sonner error'],
    ['warning', 'Sonner warning'],
    ['info', 'Sonner info'],
    ['loading', 'Sonner loading'],
    ['notify-error', 'Notify error with details'],
    ['app-error', 'Application error'],
    ['agent-failure', 'Agent failure'],
    ['agent-attention', 'Agent attention'],
    ['update-available', 'Update available'],
    ['update-downloading', 'Update downloading'],
    ['undoable', 'Undoable, countdown paused'],
    ['stack', 'Multi-toast stack'],
  ] as const;
  const updateInfo = {
    version: '4.2.0',
    releaseDate: '2026-09-07',
    releaseNotes: 'Catalog preview',
  };
  const updateAvailable = { status: 'available' as const, updateInfo };
  const updateDownloading = {
    status: 'downloading' as const,
    updateInfo,
    progress: { percent: 62, bytesPerSecond: 2_400_000, transferred: 62, total: 100 },
  };
  const staticToastIds: Array<string | number> = [];
  let stackToastIds = $state<Array<string | number>>([]);

  function options(region: string, id: string, extra: ExternalToast = {}): ExternalToast {
    return {
      id,
      toasterId: `toast-catalog-${region}`,
      duration: Number.POSITIVE_INFINITY,
      ...extra,
    };
  }

  function seedStaticPreviews() {
    staticToastIds.push(
      toast.success('Workspace saved successfully', options('success', 'toast-catalog-success')),
      toast.error('Could not save workspace', options('error', 'toast-catalog-error')),
      toast.warning('Connection is unstable', options('warning', 'toast-catalog-warning')),
      toast.info('A newer workspace snapshot is available', options('info', 'toast-catalog-info')),
      toast.loading('Synchronizing workspace', options('loading', 'toast-catalog-loading')),
      toast.custom(
        NotifyErrorToast,
        options('notify-error', 'toast-catalog-notify-error', {
          class: '!border-danger/50',
          componentProps: {
            message: 'Request failed with technical details',
            details: 'JSON-RPC -32000\nThe daemon rejected the request.',
          },
        }),
      ),
      toast.custom(
        ErrorToast,
        options('app-error', 'toast-catalog-app-error', {
          componentProps: {
            error: {
              id: 'catalog-error',
              type: 'error',
              title: 'Workspace error',
              message: 'The workspace could not be opened.',
              timestamp: new Date('2026-09-07T00:00:00Z'),
              recoverable: true,
            },
            onCopy: noOp,
            onDebug: noOp,
            onRetry: noOp,
          },
        }),
      ),
      toast.custom(
        AgentFailureToast,
        options('agent-failure', 'toast-catalog-agent-failure', {
          componentProps: {
            title: 'Implementor failed',
            errorSummary: 'The agent process exited before completing its task.',
            contextLine: 'Implementor — Toast catalog',
            retryLabel: 'Retry Implementor',
            retrying: false,
            onRetry: noOp,
            onSwitchTo: noOp,
            onClose: noOp,
          },
        }),
      ),
      toast.custom(
        AgentAttentionToast,
        options('agent-attention', 'toast-catalog-agent-attention', {
          componentProps: {
            title: 'Implementor requests a discussion',
            reason: 'Choose whether the catalog should include diagnostic details.',
            kind: 'discussion',
            onSwitchTo: noOp,
            onClose: noOp,
          },
        }),
      ),
      toast.custom(
        UpdateToast,
        options('update-available', 'toast-catalog-update-available', {
          componentProps: { previewState: updateAvailable },
        }),
      ),
      toast.custom(
        UpdateToast,
        options('update-downloading', 'toast-catalog-update-downloading', {
          componentProps: { previewState: updateDownloading },
        }),
      ),
      toast.warning(
        'Workspace archived',
        options('undoable', 'toast-catalog-undoable', {
          class: TOAST_COUNTDOWN_CLASS,
          style: '--toast-countdown-duration: 10000ms; animation-play-state: paused',
          action: { label: 'Undo', onClick: noOp },
        }),
      ),
    );
    stackToastIds = [
      toast.success('First completed task', options('stack', 'toast-catalog-stack-success')),
      toast.info('Second task is ready', options('stack', 'toast-catalog-stack-info')),
    ];
    staticToastIds.push(...stackToastIds);
  }

  function clearStaticStack() {
    stackToastIds.forEach((id) => toast.dismiss(id));
    stackToastIds = [];
  }

  function liveAppError() {
    const error: AppError = {
      id: 'catalog-live-error',
      type: 'error',
      title: 'Workspace error',
      message: 'The live application error toast is working.',
      timestamp: new Date(),
      recoverable: true,
    };
    notify.appError({ error, onCopy: noOp, onDebug: noOp, onRetry: noOp });
  }

  onMount(() => {
    seedStaticPreviews();
    return () => staticToastIds.forEach((id) => toast.dismiss(id));
  });
</script>

<div
  class="grid min-w-0 gap-6"
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state={fixture.states.join(' ')}
>
  <div class="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
    {#each previewRegions as [region, label]}
      <section class="grid min-w-0 content-start gap-2" data-toast-preview={region}>
        <h3 class="text-xs font-medium text-muted-foreground">{label}</h3>
        <Toast
          regionId={`toast-catalog-region-${region}`}
          toasterId={`toast-catalog-${region}`}
          containerAriaLabel={`${label} preview`}
          staticPosition
          staticToastCount={region === 'stack' ? stackToastIds.length : undefined}
          onClearAll={region === 'stack' ? clearStaticStack : undefined}
        />
      </section>
    {/each}
  </div>

  <section class="grid gap-3 border-t border-border pt-4" aria-label="Live toast behavior checks">
    <h3 class="text-sm font-medium">Fire live toasts</h3>
    <div class="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onclick={() => notify.success('Live success toast')}
        >Success</Button
      >
      <Button size="sm" variant="outline" onclick={() => notify.error('Live error toast')}
        >Error</Button
      >
      <Button size="sm" variant="outline" onclick={() => notify.warning('Live warning toast')}
        >Warning</Button
      >
      <Button size="sm" variant="outline" onclick={() => notify.info('Live info toast')}
        >Info</Button
      >
      <Button size="sm" variant="outline" onclick={() => notify.progress('Live loading toast')}
        >Loading</Button
      >
      <Button
        size="sm"
        variant="outline"
        onclick={() =>
          notify.error({
            message: 'Live detailed error',
            details: 'Diagnostic details from catalog',
          })}>Detailed error</Button
      >
      <Button size="sm" variant="outline" onclick={liveAppError}>Application error</Button>
      <Button
        size="sm"
        variant="outline"
        onclick={() =>
          notify.agentFailure({
            title: 'Implementor failed',
            errorSummary: 'Live failure toast',
            retryLabel: 'Retry Implementor',
            retrying: false,
            onRetry: noOp,
            onSwitchTo: noOp,
            onClose: noOp,
          })}>Agent failure</Button
      >
      <Button
        size="sm"
        variant="outline"
        onclick={() =>
          notify.custom(AgentAttentionToast, {
            componentProps: {
              title: 'Implementor requests a discussion',
              reason: 'Live attention toast',
              kind: 'discussion',
              onSwitchTo: noOp,
              onClose: noOp,
            },
          })}>Agent attention</Button
      >
      <Button
        size="sm"
        variant="outline"
        onclick={() =>
          notify.custom(UpdateToast, { componentProps: { previewState: updateAvailable } })}
        >Update available</Button
      >
      <Button
        size="sm"
        variant="outline"
        onclick={() =>
          notify.custom(UpdateToast, { componentProps: { previewState: updateDownloading } })}
        >Update downloading</Button
      >
      <Button
        size="sm"
        variant="outline"
        onclick={() => notify.undoable('Live undoable toast', { undoLabel: 'Undo', onUndo: noOp })}
        >Undoable</Button
      >
      <Button
        size="sm"
        variant="outline"
        onclick={() => {
          notify.success('Live stack: first');
          notify.info('Live stack: second');
        }}>Stack</Button
      >
      <Button size="sm" variant="ghost" onclick={() => notify.dismiss()}>Clear live toasts</Button>
    </div>
  </section>
</div>
