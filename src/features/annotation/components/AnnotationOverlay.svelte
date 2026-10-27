<script lang="ts">
  import { onMount, tick } from 'svelte';
  import AnnotationMarks from './AnnotationMarks.svelte';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faArrowRotateRight, faTriangleExclamation, faXmark } from '$lib/icons/phosphor-icons';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { m } from '$shared/paraglide/messages.js';
  import type {
    AnnotationSessionState,
    AnnotationSendRequest,
    ReportAnnotationDeliveryRequest,
  } from '$shared/annotation';
  import { subscribeToAnnotationState } from '../annotation-client';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectAnnotationDraft,
    selectAnnotationSubmission,
  } from '$store/renderer/slices/annotation/annotation-selectors';
  import {
    annotationDraftStarted,
    annotationTranscriptsReceived,
    annotationFrameSaved,
    getAnnotationStateRequested,
    submitAnnotationRequested,
    resolveAnnotationRecipientRequested,
    reportAnnotationDeliveryRequested,
    reportAnnotationScreenshotRequested,
    setAnnotationDestinationRequested,
    setAnnotationToolRequested,
    closeAnnotationRequested,
  } from '$store/renderer/slices/annotation/annotation-slice';
  import { AnnotationDeliveryError } from '../annotation-types';
  import {
    MAX_ANNOTATION_CAPTURES,
    type AnnotationFrame,
    type AnnotationEvidence,
    type AnnotationSubmission,
  } from '../annotation-types';
  import {
    ANNOTATION_PALETTE,
    normalizedBounds,
    renderAnnotationActions,
    type AnnotationAction,
    type DragAction,
    type Point,
    type Selection,
  } from '../utils/annotation-actions';

  let session = $state<AnnotationSessionState | null>(null);
  let actions = $state<AnnotationAction[]>([]);
  let redoActions = $state<AnnotationAction[]>([]);
  let draft = $state<DragAction | null>(null);
  const feedback$ = selectAnnotationDraft();
  let currentFrameElapsed = 0;
  let handledRequestId: string | null = null;
  let reportingScreenshotId: string | null = null;
  let sending = false;
  let draftEdited = false;
  let editInvalidation: Promise<unknown> | null = null;
  let sendError = $state<string | null>(null);
  let screenshotSaveError = $state<string | null>(null);
  let surface = $state<HTMLElement>();
  const deliveryLocked = $derived(
    Boolean(
      session?.delivery &&
      ['preparing', 'sending', 'uncertain', 'sent'].includes(session.delivery.status),
    ) ||
      session?.screenshotCapture?.status === 'capturing' ||
      session?.screenshotCapture?.status === 'ready',
  );

  let retryButton = $state<HTMLButtonElement | null>(null);
  let bootstrapStatus = $state<'loading' | 'empty' | 'error'>('loading');
  let closing = $state(false);
  let mounted = false;
  let loadSequence = 0;
  let unsubscribe = () => {};

  function getAnnotationStateResult() {
    const action = getAnnotationStateRequested();
    appStore.dispatch(action);
    return action.promise;
  }

  function setAnnotationTool(tool: AnnotationSessionState['tool']) {
    const action = setAnnotationToolRequested(tool);
    appStore.dispatch(action);
    return action.promise;
  }

  function closeAnnotation() {
    const action = closeAnnotationRequested();
    appStore.dispatch(action);
    return action.promise;
  }

  function sendAnnotation(submission: AnnotationSubmission) {
    const action = submitAnnotationRequested(submission);
    appStore.dispatch(action);
    return action.promise;
  }

  function point(event: PointerEvent): Point {
    const rect = surface?.getBoundingClientRect();
    if (!rect) return { x: event.clientX, y: event.clientY };
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    };
  }

  function startAction(event: PointerEvent): void {
    if (
      !session ||
      session.phase !== 'capturing' ||
      session.tool === 'mouse' ||
      deliveryLocked ||
      event.button !== 0
    )
      return;
    if (
      $feedback$.frames.length >= MAX_ANNOTATION_CAPTURES &&
      !$feedback$.frames.some(
        (frame) => frame.id === `${session?.startedAt}:${session?.screenshotRevision}`,
      )
    )
      return;
    markDraftEdited();
    const next = point(event);
    if (session.tool === 'pin') {
      actions = [
        ...actions,
        {
          kind: 'pin',
          point: next,
          number: actions.filter((item) => item.kind === 'pin').length + 1,
          elapsedMs: Date.now() - session.startedAt,
        },
      ];
      redoActions = [];
      return;
    }
    if (session.tool === 'draw') draft = { kind: 'stroke', points: [next] };
    if (session.tool === 'select') draft = { kind: 'selection', origin: next, end: next };
    if (session.tool === 'rectangle') draft = { kind: 'rectangle', origin: next, end: next };
    if (session.tool === 'arrow') draft = { kind: 'arrow', origin: next, end: next };
    if (draft) surface?.setPointerCapture(event.pointerId);
  }

  function moveAction(event: PointerEvent): void {
    if (!draft) return;
    const next = point(event);
    if (draft.kind === 'stroke') {
      const samples = event.getCoalescedEvents?.() ?? [];
      draft = { ...draft, points: [...draft.points, ...samples.map(point), next] };
    } else draft = { ...draft, end: next };
  }

  function finishAction(event: PointerEvent): void {
    if (!draft) return;
    moveAction(event);
    actions = [
      ...actions.filter((item) => item.kind !== 'selection' || draft?.kind !== 'selection'),
      draft,
    ];
    redoActions = [];
    draft = null;
  }

  function undo(): void {
    const removed = actions.at(-1);
    if (!removed) return;
    markDraftEdited();
    actions = actions.slice(0, -1);
    redoActions = [...redoActions, removed];
  }

  function redo(): void {
    const restored = redoActions.at(-1);
    if (!restored) return;
    markDraftEdited();
    redoActions = redoActions.slice(0, -1);
    actions = [...actions, restored];
  }

  function saveCurrentFrame(): void {
    if (!session) return;
    const id = `${session.startedAt}:${session.screenshotRevision}`;
    const frames = selectAnnotationDraft.select(appStore.state).frames;
    if (frames.length >= MAX_ANNOTATION_CAPTURES && !frames.some((frame) => frame.id === id))
      return;
    const palette = { ...ANNOTATION_PALETTE };
    appStore.dispatch(
      annotationFrameSaved({
        id,
        palette,
        screenshotDataUrl: session.screenshotDataUrl,
        actions: structuredClone($state.snapshot(actions)),
        width: window.innerWidth,
        height: window.innerHeight,
        elapsedMs: currentFrameElapsed,
      }),
    );
  }

  function markDraftEdited(): void {
    draftEdited = true;
    if (!session || session.delivery?.status !== 'failed' || editInvalidation) return;
    const destination = {
      workspaceId: session.destination?.workspaceId ?? session.workspaceId,
      workspaceTitle: session.destination?.workspaceTitle ?? session.workspaceTitle,
      agentId: session.destination?.agentId ?? null,
    };
    const action = setAnnotationDestinationRequested({ startedAt: session.startedAt, destination });
    appStore.dispatch(action);
    editInvalidation = action.promise
      .catch(() => {
        sendError = m.annotation_captureFailed_error();
      })
      .finally(() => {
        editInvalidation = null;
      });
  }

  function applyState(next: AnnotationSessionState): void {
    const newSession = session?.startedAt !== next.startedAt;
    if (newSession) {
      appStore.dispatch(annotationDraftStarted(next.startedAt));
      const saved = selectAnnotationDraft
        .select(appStore.state)
        .frames.find((frame) => frame.id === `${next.startedAt}:${next.screenshotRevision}`);
      actions = saved ? structuredClone(saved.actions) : [];
      currentFrameElapsed = saved?.elapsedMs ?? 0;
      redoActions = [];
      draft = null;
      draftEdited = false;
      handledRequestId = null;
      reportingScreenshotId = null;
      screenshotSaveError = null;
    } else if (next.screenshotRevision !== session?.screenshotRevision) {
      if (actions.length > 0) saveCurrentFrame();
      actions = [];
      redoActions = [];
      draft = null;
      currentFrameElapsed = Date.now() - next.startedAt;
    }
    if (session && next.tool !== session.tool) draft = null;
    session = next;
    if (
      next.screenshotCapture?.status === 'capturing' ||
      next.screenshotCapture?.status === 'saved'
    )
      screenshotSaveError = null;
    if (next.screenshotCapture?.status === 'capturing') draft = null;
    // Native state retains the whole narration; Redux appends only unseen segments.
    appStore.dispatch(annotationTranscriptsReceived(next.transcripts));
    if (next.delivery?.status === 'preparing') handledRequestId = null;
    saveRequestedScreenshot(next);
    startRequestedDelivery(next);
  }

  function saveRequestedScreenshot(next: AnnotationSessionState): void {
    const capture = next.screenshotCapture;
    if (capture?.status !== 'ready' || capture.requestId === reportingScreenshotId) return;
    reportingScreenshotId = capture.requestId;
    screenshotSaveError = null;
    let frames = selectAnnotationDraft.select(appStore.state).frames;
    if (next.tool === 'mouse' && actions.length > 0) {
      const retained = frames.some(
        (frame) =>
          frame.screenshotDataUrl === next.screenshotDataUrl &&
          JSON.stringify(frame.actions) === JSON.stringify($state.snapshot(actions)),
      );
      if (!retained) saveCurrentFrame();
      frames = selectAnnotationDraft.select(appStore.state).frames;
    }
    const id = `${next.startedAt}:screenshot:${capture.requestId}`;
    const alreadySaved = frames.some((frame) => frame.id === id);
    const saved = alreadySaved || frames.length < MAX_ANNOTATION_CAPTURES;
    if (saved && !alreadySaved) {
      appStore.dispatch(
        annotationFrameSaved({
          id,
          screenshotDataUrl: capture.screenshotDataUrl,
          actions: next.tool === 'mouse' ? [] : structuredClone($state.snapshot(actions)),
          palette: { ...ANNOTATION_PALETTE },
          width: capture.width,
          height: capture.height,
          elapsedMs: capture.elapsedMs,
        }),
      );
      markDraftEdited();
    }
    const report = reportAnnotationScreenshotRequested({
      startedAt: next.startedAt,
      requestId: capture.requestId,
      saved,
    });
    appStore.dispatch(report);
    void report.promise
      .catch(() => {
        if (
          mounted &&
          session?.startedAt === next.startedAt &&
          session.screenshotCapture?.status === 'ready' &&
          session.screenshotCapture.requestId === capture.requestId
        )
          screenshotSaveError = m.annotation_screenshotSaveFailed_error();
      })
      .finally(() => {
        if (reportingScreenshotId === capture.requestId) reportingScreenshotId = null;
      });
  }

  function startRequestedDelivery(next: AnnotationSessionState): void {
    if (
      next.delivery?.status === 'sending' &&
      next.sendRequest &&
      next.sendRequest.requestId !== handledRequestId &&
      !sending
    ) {
      handledRequestId = next.sendRequest.requestId;
      void deliver(next.startedAt, next.sendRequest);
    }
  }

  function requestIsCurrent(startedAt: number, requestId: string): boolean {
    return (
      mounted &&
      !closing &&
      session?.startedAt === startedAt &&
      session.sendRequest?.requestId === requestId &&
      session.delivery?.status === 'sending'
    );
  }

  async function reportDelivery(request: ReportAnnotationDeliveryRequest): Promise<void> {
    const action = reportAnnotationDeliveryRequested(request);
    appStore.dispatch(action);
    await action.promise;
  }

  async function deliver(startedAt: number, request: AnnotationSendRequest): Promise<void> {
    sending = true;
    sendError = null;
    let delivered = false;
    try {
      const saved = selectAnnotationSubmission.select(appStore.state);
      const retry = saved?.messageId === request.requestId;
      // A pointer edit and toolbar Send can cross in transit. Never resend the old
      // snapshot as if it contained the newer marks; leave the draft available.
      if (retry && draftEdited && !appStore.state.annotation.uncertainMessageId) {
        await reportDelivery({
          startedAt,
          requestId: request.requestId,
          status: 'failed',
          error: m.annotation_captureFailed_error(),
        });
        markDraftEdited();
        return;
      }
      let submission: AnnotationSubmission;
      if (retry) {
        submission = saved;
      } else {
        saveCurrentFrame();
        const feedback = selectAnnotationDraft.select(appStore.state);
        const frames = await Promise.all(
          feedback.frames.map(async (frame): Promise<AnnotationEvidence> => ({
            id: frame.id,
            imageDataUrl: await renderImage(frame),
            elapsedMs: frame.elapsedMs,
            pins: frame.actions
              .filter((action) => action.kind === 'pin')
              .map((pin) => ({ number: pin.number, elapsedMs: pin.elapsedMs })),
          })),
        );
        if (!requestIsCurrent(startedAt, request.requestId)) return;
        if (!frames.length) throw new Error('annotation-no-captures');
        const resolve = resolveAnnotationRecipientRequested(request.destination, request.requestId);
        appStore.dispatch(resolve);
        const recipient = await resolve.promise;
        if (!requestIsCurrent(startedAt, request.requestId) || !session) return;
        submission = {
          messageId: request.requestId,
          sourceWorkspaceId: session.workspaceId,
          sourceWorkspaceTitle: session.workspaceTitle,
          recipient,
          message: feedback.message,
          frames,
        };
      }
      if (!requestIsCurrent(startedAt, request.requestId)) return;
      draftEdited = false;
      await sendAnnotation(submission);
      delivered = true;
      if (!requestIsCurrent(startedAt, request.requestId)) return;
      await reportDelivery({ startedAt, requestId: request.requestId, status: 'sent' });
      if (mounted && session?.startedAt === startedAt) await closeAnnotation();
    } catch (error) {
      if (!mounted || session?.startedAt !== startedAt) return;
      if (delivered) {
        sendError = m.annotation_sentCloseFailed_message();
        return;
      }
      const uncertain =
        (error instanceof AnnotationDeliveryError && error.uncertain) ||
        appStore.state.annotation.uncertainMessageId === request.requestId;
      const message =
        error instanceof Error && error.message === 'annotation-no-agent'
          ? m.annotation_noAgent_error()
          : m.annotation_sendFailed_error();
      sendError = message;
      if (requestIsCurrent(startedAt, request.requestId)) {
        await reportDelivery({
          startedAt,
          requestId: request.requestId,
          status: uncertain ? 'uncertain' : 'failed',
          error: message,
        }).catch(() => undefined);
      }
    } finally {
      sending = false;
      // A retry can arrive while the previous report acknowledgement settles.
      if (mounted && session) startRequestedDelivery(session);
    }
  }

  async function loadState(): Promise<void> {
    const sequence = ++loadSequence;
    bootstrapStatus = 'loading';
    session = null;
    unsubscribe();
    unsubscribe = () => {};
    try {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- this facade dispatches an async Redux action; its saga owns the request
      const result = await getAnnotationStateResult();
      if (!mounted || sequence !== loadSequence) return;
      if (!result.success) {
        window.close();
        return;
      }
      if (!result.state) {
        bootstrapStatus = 'empty';
        await tick();
        if (mounted && sequence === loadSequence) retryButton?.focus();
        return;
      }
      applyState(result.state);
      if (mounted && sequence === loadSequence) {
        // eslint-disable-next-line intent/no-component-async-data-fetch -- subscribes only to Redux state; the annotation saga owns IPC
        unsubscribe = subscribeToAnnotationState(applyState);
      }
    } catch {
      if (!mounted || sequence !== loadSequence) return;
      bootstrapStatus = 'error';
      await tick();
      if (mounted && sequence === loadSequence) retryButton?.focus();
    }
  }

  async function closeSafely(): Promise<void> {
    if (closing) return;
    closing = true;
    try {
      await closeAnnotation();
    } catch {
      window.close();
    }
  }

  async function renderImage(frame: AnnotationFrame): Promise<string> {
    const image = new Image();
    image.src = frame.screenshotDataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    const resolutionScale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * resolutionScale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * resolutionScale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('annotation-canvas-unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / frame.width;
    const scaleY = canvas.height / frame.height;
    renderAnnotationActions(context, frame.actions, scaleX, scaleY, frame.palette);
    const selection = frame.actions.findLast(
      (item): item is Selection => item.kind === 'selection',
    );
    if (!selection) return canvas.toDataURL('image/png');
    const rect = normalizedBounds(selection);
    if (rect.width < 4 || rect.height < 4) return canvas.toDataURL('image/png');
    const cropped = document.createElement('canvas');
    cropped.width = Math.round(rect.width * scaleX);
    cropped.height = Math.round(rect.height * scaleY);
    const cropContext = cropped.getContext('2d');
    if (!cropContext) throw new Error('annotation-canvas-unavailable');
    cropContext.drawImage(
      canvas,
      rect.x * scaleX,
      rect.y * scaleY,
      cropped.width,
      cropped.height,
      0,
      0,
      cropped.width,
      cropped.height,
    );
    return cropped.toDataURL('image/png');
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!session) {
      if (event.key === 'Escape') {
        event.preventDefault();
        void closeSafely();
      }
      return;
    }
    if (deliveryLocked || session.phase === 'review') return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (!session || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape') {
      event.preventDefault();
      void setAnnotationTool('mouse').catch(() => {
        sendError = m.annotation_captureFailed_error();
      });
    } else if (key === 'v') void setAnnotationTool('mouse');
    else if (key === 's') void setAnnotationTool('select');
    else if (key === 'p' || key === 'd') void setAnnotationTool('draw');
    else if (key === 'r') void setAnnotationTool('rectangle');
    else if (key === 'a') void setAnnotationTool('arrow');
    else if (key === 'c') void setAnnotationTool('pin');
  }

  onMount(() => {
    mounted = true;
    void loadState();
    window.addEventListener('keydown', handleKeydown);
    return () => {
      mounted = false;
      loadSequence += 1;
      unsubscribe();
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

{#if session}
  <main
    bind:this={surface}
    tabindex="-1"
    class:reviewing={session.phase === 'review'}
    data-tool={session.tool}
    aria-label={m.annotation_review_title()}
    onpointerdown={startAction}
    onpointermove={moveAction}
    onpointerup={finishAction}
    onpointercancel={() => {
      draft = null;
    }}
  >
    {#if session.phase === 'review'}
      <img src={session.screenshotDataUrl} alt="" draggable="false" />
    {/if}
    {#if session.tool !== 'mouse' || session.phase === 'review'}
      <AnnotationMarks
        actions={[...actions, ...(draft ? [draft] : [])]}
        width={window.innerWidth}
        height={window.innerHeight}
      />
    {/if}
    <div class="capture-notices">
      {#if session.phase !== 'review' && $feedback$.frames.length >= MAX_ANNOTATION_CAPTURES}
        <p class="capture-limit type-body" role="status">{m.annotation_captureLimit_hint()}</p>
      {/if}
      {#if sendError && !deliveryLocked}
        <p class="capture-limit type-caption" role="alert">{sendError}</p>
      {/if}
      {#if screenshotSaveError}
        <p class="capture-limit type-caption" role="alert">{screenshotSaveError}</p>
      {/if}
    </div>
  </main>
{:else}
  <main class="bootstrap-shell" aria-busy={bootstrapStatus === 'loading'}>
    <section
      class:error-state={bootstrapStatus === 'error'}
      class="bootstrap-card"
      role="status"
      aria-labelledby="annotation-bootstrap-title"
      aria-describedby={bootstrapStatus === 'loading'
        ? undefined
        : 'annotation-bootstrap-description'}
      aria-live={bootstrapStatus === 'loading' ? 'polite' : undefined}
    >
      {#if bootstrapStatus === 'loading'}
        <div aria-hidden="true"><IntentMarkLoader size={28} /></div>
        <h1 class="type-body font-medium" id="annotation-bootstrap-title">
          {m.annotation_bootstrapLoading_title()}
        </h1>
      {:else}
        <div class="bootstrap-icon" aria-hidden="true">
          <Fa icon={faTriangleExclamation} />
        </div>
        <h1 class="type-body font-medium" id="annotation-bootstrap-title">
          {bootstrapStatus === 'empty'
            ? m.annotation_bootstrapEmpty_title()
            : m.annotation_bootstrapFailed_title()}
        </h1>
        <p
          class="type-body"
          id="annotation-bootstrap-description"
          role={bootstrapStatus === 'error' ? 'alert' : undefined}
        >
          {bootstrapStatus === 'empty'
            ? m.annotation_bootstrapEmpty_description()
            : m.annotation_bootstrapFailed_description()}
        </p>
        <div class="bootstrap-actions">
          <Button variant="outline" disabled={closing} onclick={closeSafely}>
            <Fa icon={faXmark} />
            {m.annotation_bootstrapClose_label()}
          </Button>
          <Button bind:ref={retryButton} disabled={closing} onclick={loadState}>
            <Fa icon={faArrowRotateRight} />
            {m.annotation_bootstrapRetry_label()}
          </Button>
        </div>
      {/if}
      <p class="escape-hint type-caption">{m.annotation_bootstrapEscape_hint()}</p>
    </section>
  </main>
{/if}

<style>
  :global(html),
  :global(body) {
    overflow: hidden;
    background: transparent;
  }
  main {
    position: fixed;
    inset: 0;
    touch-action: none;
    user-select: none;
  }
  main[data-tool='mouse'] {
    pointer-events: none;
    cursor: default;
  }
  main[data-tool='select'],
  main[data-tool='draw'],
  main[data-tool='rectangle'],
  main[data-tool='arrow'] {
    cursor: crosshair;
  }
  main[data-tool='pin'] {
    cursor: cell;
  }
  main.reviewing {
    cursor: default;
  }
  .bootstrap-shell {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    padding: 24px;
    cursor: default;
    background: color-mix(in srgb, hsl(var(--background)) 18%, transparent);
  }
  .bootstrap-card {
    width: min(360px, calc(100vw - 48px));
    box-sizing: border-box;
    padding: 20px;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    color: hsl(var(--foreground));
    background: hsl(var(--background));
    box-shadow: var(--shadow-surface-3);
    text-align: center;
  }
  .bootstrap-card h1 {
    margin: 12px 0 0;
  }
  .bootstrap-card > p {
    margin: 8px auto 0;
    max-width: 32ch;
  }
  .bootstrap-card.error-state .bootstrap-icon {
    color: hsl(var(--danger));
  }
  .bootstrap-icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin: 0 auto;
    border-radius: var(--radius-medium);
    color: hsl(var(--muted-foreground));
    background: hsl(var(--muted));
  }
  .bootstrap-actions {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-top: 18px;
  }
  .bootstrap-actions :global(svg) {
    width: 14px;
    height: 14px;
  }
  .bootstrap-card .escape-hint {
    margin-top: 14px;
    color: hsl(var(--muted-foreground));
  }
  main > img {
    width: 100%;
    height: 100%;
    object-fit: fill;
    pointer-events: none;
  }
  .capture-notices {
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: max-content;
    max-width: calc(100vw - 48px);
    pointer-events: none;
  }
  .capture-limit {
    margin: 0;
    overflow-wrap: anywhere;
    padding: 12px 16px;
    border-radius: var(--radius-large);
    color: hsl(var(--foreground));
    background: hsl(var(--background));
    box-shadow: var(--shadow-surface-4);
  }
</style>
