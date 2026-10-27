<script lang="ts">
  import { onMount } from 'svelte';
  import AnnotationToolbarPanel from './AnnotationToolbarPanel.svelte';
  import type {
    AnnotationDestination,
    AnnotationSessionState,
    AnnotationTool,
  } from '$shared/annotation';
  import { m } from '$shared/paraglide/messages.js';
  import { subscribeToAnnotationState } from '../annotation-client';
  import { store as appStore } from '$store/renderer/store';
  import {
    getAnnotationStateRequested,
    setAnnotationToolRequested,
    closeAnnotationRequested,
    loadAnnotationWorkspacesRequested,
    loadAnnotationRecipientsRequested,
    setAnnotationDestinationRequested,
    requestAnnotationSendRequested,
    requestAnnotationScreenshotRequested,
    setAnnotationToolbarLayoutRequested,
  } from '$store/renderer/slices/annotation/annotation-slice';
  import {
    selectAnnotationWorkspaces,
    selectAnnotationRecipients,
  } from '$store/renderer/slices/annotation/annotation-selectors';
  import {
    createAnnotationVoiceController,
    type AnnotationVoiceController,
    type AnnotationVoiceStatus,
  } from '../annotation-voice-service';

  let session = $state<AnnotationSessionState | null>(null);
  let toolbarElement = $state<HTMLDivElement>();
  let toolbarExpanded = $state(false);
  const workspaces$ = selectAnnotationWorkspaces();
  const recipients$ = selectAnnotationRecipients();
  let workspaceId = $state('');
  let recipientId = $state('');
  let workspacesLoading = $state(false);
  let recipientsLoading = $state(false);
  let selectionPending = $state(false);
  let destinationError = $state('');
  let voiceStatus = $state<AnnotationVoiceStatus>('idle');
  let sendPending = $state(false);
  let screenshotRequested = $state(false);
  let localError = $state('');
  let sendFailure = $state(false);
  let voiceController: AnnotationVoiceController | null = null;
  let recordingStartedAt: number | null = null;
  let elapsedMs = $state(0);
  let closing = false;
  let alive = false;
  let recipientSequence = 0;
  let workspaceSequence = 0;

  const availableRecipients = $derived(
    $recipients$.filter((item) => item.workspaceId === workspaceId),
  );
  const selectedRecipient = $derived(availableRecipients.find((item) => item.id === recipientId));
  const workspaceOptions = $derived(
    $workspaces$.map((item) => ({ value: item.id, label: item.title })),
  );
  const recipientOptions = $derived(
    availableRecipients.map((item) => ({
      value: item.id,
      label: item.isDefault ? `${item.name} · ${m.annotation_mainAgent_label()}` : item.name,
    })),
  );
  const deliveryLocked = $derived(
    session?.delivery?.status === 'preparing' || session?.delivery?.status === 'sending',
  );
  const uncertain = $derived(session?.delivery?.status === 'uncertain');
  const sent = $derived(session?.delivery?.status === 'sent');
  const pending = $derived(sendPending || deliveryLocked);
  const locked = $derived(pending || uncertain || sent);
  const screenshotPending = $derived(
    screenshotRequested ||
      session?.screenshotCapture?.status === 'capturing' ||
      session?.screenshotCapture?.status === 'ready',
  );
  const screenshotSaved = $derived(session?.screenshotCapture?.status === 'saved');
  const screenshotSaving = $derived(session?.screenshotCapture?.status === 'ready');
  const screenshotDisabled = $derived(
    session?.screenshotCapture?.status === 'failed' && session.screenshotCapture.error === 'limit',
  );
  const sendDisabled = $derived(
    selectionPending ||
      workspacesLoading ||
      recipientsLoading ||
      !selectedRecipient ||
      voiceStatus === 'error',
  );
  const errorMessage = $derived(
    localError ||
      (session?.screenshotCapture?.status === 'failed'
        ? session.screenshotCapture.error === 'limit'
          ? m.annotation_captureLimit_hint()
          : m.annotation_captureFailed_error()
        : '') ||
      (session?.delivery?.status === 'failed' || uncertain
        ? session?.delivery?.error || m.annotation_sendFailed_error()
        : ''),
  );

  $effect(() => {
    const element = toolbarElement;
    const startedAt = session?.startedAt;
    const expanded = toolbarExpanded;
    if (!element || !startedAt) return;
    const root: HTMLDivElement = element;
    let frame = 0;
    let lastGeometry = '';
    let disposed = false;
    const resizeObserver = new ResizeObserver(scheduleLayout);

    function scheduleLayout(): void {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        const surfaces = root.querySelectorAll<HTMLElement>(
          '[data-annotation-surface], .annotation-destination-popover',
        );
        const interactiveRects = Array.from(surfaces, (surface) => {
          resizeObserver.observe(surface);
          const rect = surface.getBoundingClientRect();
          // The popup is above the viewport until native expansion completes.
          // Send the visible strip now; the resize reports the revealed popup.
          const x = Math.max(0, rect.left);
          const y = Math.max(0, rect.top);
          const right = Math.min(window.innerWidth, rect.right);
          const bottom = Math.min(window.innerHeight, rect.bottom);
          return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
        }).filter((rect) => rect.width > 0 && rect.height > 0);
        const geometry = JSON.stringify({ expanded, interactiveRects });
        if (geometry === lastGeometry || !startedAt) return;
        lastGeometry = geometry;
        const action = setAnnotationToolbarLayoutRequested({
          startedAt,
          expanded,
          interactiveRects,
        });
        appStore.dispatch(action);
        void action.promise.catch(() => {
          if (!disposed) lastGeometry = '';
        });
      });
    }

    const mutations = new MutationObserver(scheduleLayout);
    mutations.observe(root, { childList: true, subtree: true });
    resizeObserver.observe(root);
    window.addEventListener('resize', scheduleLayout);
    scheduleLayout();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleLayout);
    };
  });

  function getAnnotationState() {
    const action = getAnnotationStateRequested();
    appStore.dispatch(action);
    return action.promise;
  }

  function setAnnotationTool(tool: AnnotationTool) {
    const action = setAnnotationToolRequested(tool);
    appStore.dispatch(action);
    return action.promise;
  }

  function closeAnnotation() {
    const action = closeAnnotationRequested();
    appStore.dispatch(action);
    return action.promise;
  }

  async function setDestination(destination: AnnotationDestination): Promise<void> {
    if (!session) return;
    const current = session.destination;
    if (
      current?.workspaceId === destination.workspaceId &&
      current.agentId === destination.agentId &&
      current.workspaceTitle === destination.workspaceTitle
    )
      return;
    const action = setAnnotationDestinationRequested({ startedAt: session.startedAt, destination });
    appStore.dispatch(action);
    await action.promise;
  }

  async function loadRecipients(id: string, preferredId = ''): Promise<void> {
    const sequence = ++recipientSequence;
    recipientsLoading = true;
    destinationError = '';
    recipientId = '';
    try {
      const action = loadAnnotationRecipientsRequested(id);
      appStore.dispatch(action);
      const recipients = await action.promise;
      if (!alive || sequence !== recipientSequence || id !== workspaceId) return;
      const chosen =
        recipients.find((item) => item.id === preferredId) ??
        recipients.find(
          (item) =>
            session?.destination?.workspaceId === id &&
            session.destination.agentId &&
            item.agentId === session.destination.agentId,
        ) ??
        recipients.find((item) => item.isDefault);
      recipientId = chosen?.id ?? '';
      if (!chosen) {
        destinationError = recipients.length
          ? m.annotation_chooseAgent_message()
          : m.annotation_noAgent_error();
        return;
      }
      const workspace = $workspaces$.find((item) => item.id === id);
      if (!workspace) return;
      await setDestination({
        workspaceId: id,
        workspaceTitle: workspace.title,
        agentId: chosen.isDefault ? null : chosen.agentId,
      });
    } catch {
      if (alive && sequence === recipientSequence) {
        recipientId = '';
        destinationError = m.annotation_recipientsFailed_error();
      }
    } finally {
      if (alive && sequence === recipientSequence) recipientsLoading = false;
    }
  }

  async function refreshDestinations(): Promise<void> {
    if (locked || closing || workspacesLoading) return;
    const sequence = ++workspaceSequence;
    workspacesLoading = true;
    destinationError = '';
    try {
      const action = loadAnnotationWorkspacesRequested();
      appStore.dispatch(action);
      const workspaces = await action.promise;
      if (!alive || sequence !== workspaceSequence) return;
      const preferred = workspaceId || session?.destination?.workspaceId || session?.workspaceId;
      workspaceId = workspaces.find((item) => item.id === preferred)?.id ?? '';
      // eslint-disable-next-line intent/no-component-async-data-fetch -- this facade dispatches loadAnnotationRecipientsRequested; the saga owns recipient loading
      if (workspaceId) await loadRecipients(workspaceId, recipientId);
      else recipientId = '';
    } catch {
      if (alive && sequence === workspaceSequence)
        destinationError = m.annotation_workspaceLoadFailed_error();
    } finally {
      if (alive && sequence === workspaceSequence) workspacesLoading = false;
    }
  }

  async function chooseWorkspace(id: string): Promise<void> {
    if (locked || closing || selectionPending || id === workspaceId) return;
    workspaceId = id;
    localError = '';
    // eslint-disable-next-line intent/no-component-async-data-fetch -- this facade dispatches loadAnnotationRecipientsRequested; the saga owns recipient loading
    await loadRecipients(id);
  }

  async function chooseRecipient(id: string): Promise<void> {
    if (locked || closing || selectionPending || recipientsLoading) return;
    const recipient = availableRecipients.find((item) => item.id === id);
    const workspace = $workspaces$.find((item) => item.id === workspaceId);
    if (!recipient || !workspace) return;
    selectionPending = true;
    destinationError = '';
    try {
      await setDestination({
        workspaceId,
        workspaceTitle: workspace.title,
        agentId: recipient.isDefault ? null : recipient.agentId,
      });
      if (alive && workspaceId === workspace.id) recipientId = id;
    } catch {
      destinationError = m.annotation_recipientsFailed_error();
    } finally {
      selectionPending = false;
    }
  }

  async function chooseTool(tool: AnnotationTool): Promise<void> {
    if (locked || closing || screenshotPending) return;
    localError = '';
    sendFailure = false;
    try {
      await setAnnotationTool(tool);
    } catch {
      localError = m.annotation_captureFailed_error();
    }
  }

  async function takeScreenshot(): Promise<void> {
    if (
      !session ||
      locked ||
      closing ||
      screenshotRequested ||
      session.screenshotCapture?.status === 'capturing' ||
      screenshotDisabled
    )
      return;
    screenshotRequested = true;
    localError = '';
    sendFailure = false;
    try {
      const action = requestAnnotationScreenshotRequested({ startedAt: session.startedAt });
      appStore.dispatch(action);
      await action.promise;
    } catch {
      if (alive && !closing) localError = m.annotation_captureFailed_error();
    } finally {
      if (alive) screenshotRequested = false;
    }
  }

  function ensureVoiceController(): AnnotationVoiceController | null {
    if (!session) return null;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- local microphone controller; transcripts are submitted through Redux
    voiceController ??= createAnnotationVoiceController(
      session.workspaceId,
      {
        onStatus: (status) => {
          if (status === 'recording' && voiceStatus !== 'recording') {
            recordingStartedAt = Date.now();
            elapsedMs = 0;
          } else if (status !== 'recording') recordingStartedAt = null;
          voiceStatus = status;
        },
        onError: () => undefined,
      },
      session.startedAt,
    );
    return voiceController;
  }

  async function toggleVoice(): Promise<void> {
    if (locked || closing) return;
    const controller = ensureVoiceController();
    if (!controller) return;
    if (controller.status === 'requesting' || controller.status === 'recording')
      await controller.stop();
    else if (controller.status === 'error') await controller.retry();
    else if (controller.status === 'idle') await controller.start();
  }

  async function send(): Promise<void> {
    if (!session || pending || sent || closing || sendDisabled || screenshotPending) return;
    const startedAt = session.startedAt;
    sendPending = true;
    localError = '';
    sendFailure = false;
    try {
      if (
        voiceController &&
        (voiceController.status === 'requesting' ||
          voiceController.status === 'recording' ||
          voiceController.status === 'transcribing')
      )
        await voiceController.stop();
      if (
        !alive ||
        closing ||
        session?.startedAt !== startedAt ||
        voiceController?.status === 'error'
      )
        return;
      const retryRequestId =
        session.delivery?.status === 'failed' ? session.sendRequest?.requestId : undefined;
      const action = requestAnnotationSendRequested({
        startedAt,
        ...(retryRequestId ? { retryRequestId } : {}),
      });
      appStore.dispatch(action);
      await action.promise;
      // eslint-disable-next-line intent/no-component-async-data-fetch -- this facade dispatches getAnnotationStateRequested; the saga owns native IPC
      const result = await getAnnotationState();
      if (
        alive &&
        result.state?.startedAt === startedAt &&
        !['failed', 'uncertain', 'sent'].includes(session?.delivery?.status ?? '')
      )
        session = result.state;
    } catch {
      if (alive && !closing) {
        localError = m.annotation_sendFailed_error();
        sendFailure = true;
      }
    } finally {
      if (alive) sendPending = false;
    }
  }

  function cancelVoice(): void {
    voiceController?.cancel();
    voiceController = null;
    voiceStatus = 'idle';
    recordingStartedAt = null;
    elapsedMs = 0;
  }

  async function discard(): Promise<void> {
    if (closing || deliveryLocked) return;
    closing = true;
    cancelVoice();
    try {
      await closeAnnotation();
    } catch {
      localError = m.annotation_captureFailed_error();
      closing = false;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (
      toolbarExpanded ||
      event.defaultPrevented ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        'input, textarea, select, [contenteditable="true"], [role="listbox"], [role="option"]',
      )
    )
      return;
    const key = event.key.toLowerCase();
    const shortcuts: Partial<Record<string, AnnotationTool>> = {
      v: 'mouse',
      s: 'select',
      p: 'draw',
      d: 'draw',
      r: 'rectangle',
      a: 'arrow',
      c: 'pin',
    };
    const tool = shortcuts[key];
    if (tool) {
      event.preventDefault();
      void chooseTool(tool);
    } else if (key === 'm') {
      event.preventDefault();
      void toggleVoice();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      void chooseTool('mouse');
    }
  }

  onMount(() => {
    alive = true;
    const timer = window.setInterval(() => {
      if (recordingStartedAt !== null) elapsedMs = Date.now() - recordingStartedAt;
    }, 250);
    // eslint-disable-next-line intent/no-component-async-data-fetch -- subscribes to Redux; saga owns native events
    const unsubscribe = subscribeToAnnotationState((value) => {
      session = value;
    });
    void getAnnotationState()
      .then((result) => {
        if (!alive) return;
        session = result.state ?? null;
        if (session) void refreshDestinations();
      })
      .catch(() => {
        if (alive) localError = m.annotation_bootstrapFailed_description();
      });
    window.addEventListener('keydown', handleKeydown);
    return () => {
      alive = false;
      recipientSequence += 1;
      workspaceSequence += 1;
      unsubscribe();
      closing = true;
      cancelVoice();
      window.clearInterval(timer);
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

{#if session}
  <div class="toolbar-window" bind:this={toolbarElement}>
    <AnnotationToolbarPanel
      {workspaceId}
      {recipientId}
      recipientIsDefault={selectedRecipient?.isDefault === true}
      {workspaceOptions}
      {recipientOptions}
      {workspacesLoading}
      {recipientsLoading}
      {destinationError}
      tool={session.tool}
      {voiceStatus}
      {elapsedMs}
      {pending}
      {screenshotPending}
      {screenshotSaved}
      {screenshotSaving}
      {screenshotDisabled}
      {deliveryLocked}
      {uncertain}
      {sent}
      {sendDisabled}
      {errorMessage}
      sendFailed={sendFailure || session.delivery?.status === 'failed'}
      onExpanded={(open) => (toolbarExpanded = open)}
      onWorkspace={chooseWorkspace}
      onRecipient={chooseRecipient}
      onRefresh={refreshDestinations}
      onTool={chooseTool}
      onScreenshot={takeScreenshot}
      onVoice={toggleVoice}
      onSend={send}
      onCancel={discard}
    />
  </div>
{/if}

<style>
  .toolbar-window {
    width: 100vw;
    height: 100dvh;
    display: flex;
    align-items: flex-end;
    padding-bottom: 4px;
    padding-inline: 4px;
    box-sizing: border-box;
  }
  :global(html),
  :global(body) {
    overflow: hidden;
    background: transparent;
  }
</style>
