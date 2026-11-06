<script lang="ts" module>
  import type { DockMediaEdit, DockMediaSource } from '$shared/dock-media-edit';
  import type { ScreenshotFrameMapping } from './screenshot-edit-geometry';
  // One counter per editor document, including component remounts on retarget.
  let noteGeneration = 0;
  export interface ScreenshotEditorBundle {
    source: DockMediaSource;
    edit: DockMediaEdit;
    mediaUrl: string;
    candidateToken?: string;
  }
  /** Candidate is authorized and resolved by the owner, never by this view. */
  export interface ScreenshotRetakeCandidate {
    candidateToken: string;
    source: DockMediaSource;
    mediaUrl: string;
    mapping: ScreenshotFrameMapping;
  }
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type {
    DockCaptureEditorSnapshot,
    DockCaptureEditorSaveResult,
    DockCaptureEditorNoteDictationRequest,
    DockCaptureEditorNoteDictationAck,
    DockCaptureEditorNoteDictationUpdate,
  } from '$shared/dock-capture-editor';
  import {
    DOCK_MEDIA_OUTPUT_VERSION,
    defaultDockMediaEdit,
    DockMediaEditSchema,
    DockMediaSourceSchema,
    planDockMediaOutput,
  } from '$shared/dock-media-edit';
  import DockCaptureEditorShell from '../DockCaptureEditorShell.svelte';
  import { createEditTransaction } from '../edit-transaction.svelte';
  import DockScreenshotEditor from './DockScreenshotEditor.svelte';
  import { retakeScreenshotEdit } from './screenshot-edit-geometry';

  let {
    snapshot,
    onClose,
    onAttach,
    discardRequest = 0,
    onDirtyChange,
    onDiscardRequested,
    onKeepEditing,
    onSave,
    onRetake,
    onNoteDictation,
    noteDictationUpdate = null,
  }: {
    snapshot: DockCaptureEditorSnapshot;
    onClose: () => void;
    onAttach?: () => void | boolean | Promise<void | boolean>;
    discardRequest?: number;
    onDirtyChange?: (dirty: boolean) => void;
    onDiscardRequested?: () => void;
    onKeepEditing?: () => void;
    onSave?: (request: {
      edit: DockMediaEdit;
      replacement?: { candidateToken: string };
    }) => Promise<DockCaptureEditorSaveResult>;
    onRetake?: (bundle: ScreenshotEditorBundle) => Promise<ScreenshotRetakeCandidate | null>;
    onNoteDictation?: (
      request: DockCaptureEditorNoteDictationRequest,
    ) => Promise<DockCaptureEditorNoteDictationAck>;
    noteDictationUpdate?: DockCaptureEditorNoteDictationUpdate | null;
  } = $props();
  function seed(value: DockCaptureEditorSnapshot): ScreenshotEditorBundle | null {
    const source = value.source;
    if (
      value.kind !== 'screenshot' ||
      source?.kind !== 'screenshot' ||
      source.visuals !== 'clean' ||
      value.provenance.visuals !== 'clean'
    )
      return null;
    // The source's captured marks are the authoritative baseline. Only without them is the
    // legacy mark list (no geometry) refused rather than turned into an invented edit.
    if (!value.saved && !source.capturedMarks && value.marks.length) return null;
    const edit =
      value.saved ??
      defaultDockMediaEdit(source, source.capturedMarks ?? [], value.transcript ?? null);
    if (
      !DockMediaEditSchema.safeParse(edit).success ||
      planDockMediaOutput(edit, source, null).errors.length
    )
      return null;
    return { source, edit, mediaUrl: value.mediaUrl };
  }
  // The route keys this component by the main-owned open identity.
  // svelte-ignore state_referenced_locally -- one bound edit transaction per mount.
  const initial = seed(snapshot);
  // svelte-ignore state_referenced_locally -- late callbacks may not close a new session.
  const openId = snapshot.openId;
  const workspaceId = snapshot.workspaceId;
  const agentId = snapshot.agentId;
  const ownsSnapshot = () =>
    snapshot.openId === openId &&
    snapshot.workspaceId === workspaceId &&
    snapshot.agentId === agentId;
  const edits = initial ? createEditTransaction(initial) : null;
  let active = true;
  let saving = $state(false);
  let finishing = $state(false);
  let retaking = $state(false);
  let error = $state<string | null>(null);
  type NoteControl = {
    request: DockCaptureEditorNoteDictationRequest;
    handler: NonNullable<typeof onNoteDictation>;
    started: Promise<DockCaptureEditorNoteDictationAck>;
    stopping: Promise<void> | null;
    terminal: boolean;
  };
  type NoteSession = {
    control: NoteControl;
    sourceId: string;
    sourceRevision: number;
    candidateToken?: string;
    boundSourceId?: string;
    boundSourceRevision?: number;
    baseline: string;
    text: string;
    phase: 'starting' | 'listening' | 'stopping';
  };
  let noteSession = $state.raw<NoteSession | null>(null);
  let selectedMarkId = $state<string | null>(null);
  let seenDiscardRequest = 0;
  const dictatingId = $derived(
    noteSession?.phase === 'listening' ? noteSession.control.request.markId : null,
  );
  function appendNote(baseline: string, text: string): string {
    const separator = baseline && text && !/\s$/.test(baseline) && !/^\s/.test(text) ? ' ' : '';
    return (baseline + separator + text).slice(0, 20000);
  }
  const notePreview = $derived(
    noteSession
      ? {
          markId: noteSession.control.request.markId,
          text: appendNote(noteSession.baseline, noteSession.text),
        }
      : null,
  );
  const dirty = $derived(
    interactionPending ||
      !!edits?.dirty ||
      !!(noteSession && notePreview?.text !== noteSession.baseline),
  );
  function ownsNote(session: NoteSession, bundle = edits?.draft): boolean {
    if (
      !active ||
      snapshot.openId !== session.control.request.openId ||
      !bundle ||
      snapshot.source?.id !== session.boundSourceId ||
      snapshot.source?.revision !== session.boundSourceRevision ||
      bundle.source.id !== session.sourceId ||
      bundle.source.revision !== session.sourceRevision ||
      bundle.candidateToken !== session.candidateToken
    )
      return false;
    const mark = bundle.edit.marks.find(
      (mark) => mark.id === session.control.request.markId && mark.included,
    );
    return !!mark && mark.note === session.baseline;
  }
  function clearFailedNote(control: NoteControl): void {
    control.terminal = true;
    if (noteSession?.control === control) {
      noteSession = null;
      error = m.dock_screenshotEditor_dictationUnavailable();
    }
  }
  function stopOwnedNote(control: NoteControl): Promise<void> {
    if (control.stopping) return control.stopping;
    control.stopping = (async () => {
      const ack = await control.started;
      if (!ack.ok || control.terminal) return;
      try {
        const stopped = await control.handler({ ...control.request, phase: 'stop' });
        if (!stopped.ok) clearFailedNote(control);
      } catch {
        clearFailedNote(control);
      }
    })();
    return control.stopping;
  }
  function cancelNote(markId?: string): Promise<void> {
    const session = noteSession;
    if (!session || (markId !== undefined && session.control.request.markId !== markId))
      return Promise.resolve();
    noteSession = null;
    return stopOwnedNote(session.control);
  }
  function stopNote(markId: string): void {
    const session = noteSession;
    if (!session || session.control.request.markId !== markId) return;
    if (session.phase !== 'stopping') noteSession = { ...session, phase: 'stopping' };
    void stopOwnedNote(session.control);
  }
  function dictateNote(markId: string, phase: 'start' | 'stop'): void {
    if (phase === 'stop') {
      stopNote(markId);
      return;
    }
    if (!active || !edits || !onNoteDictation || saving || retaking || snapshot.openId !== openId)
      return;
    if (noteSession) {
      stopNote(noteSession.control.request.markId);
      return;
    }
    const bundle = edits.draft;
    const mark = bundle.edit.marks.find((mark) => mark.id === markId && mark.included);
    if (!mark) return;
    const request: DockCaptureEditorNoteDictationRequest = {
      openId,
      markId,
      generation: ++noteGeneration,
      phase: 'start',
    };
    const handler = onNoteDictation;
    const started = Promise.resolve()
      .then(() => handler(request))
      .catch((): DockCaptureEditorNoteDictationAck => ({ ok: false, error: 'failed' }));
    const control: NoteControl = { request, handler, started, stopping: null, terminal: false };
    selectedMarkId = markId;
    error = null;
    noteSession = {
      control,
      sourceId: bundle.source.id,
      sourceRevision: bundle.source.revision,
      candidateToken: bundle.candidateToken,
      boundSourceId: snapshot.source?.id,
      boundSourceRevision: snapshot.source?.revision,
      baseline: mark.note,
      text: '',
      phase: 'starting',
    };
    void started.then((ack) => {
      if (!ack.ok) {
        clearFailedNote(control);
        return;
      }
      if (noteSession?.control === control && noteSession.phase === 'starting')
        noteSession = { ...noteSession, phase: 'listening' };
    });
  }
  function receiveNote(update: DockCaptureEditorNoteDictationUpdate | null): void {
    const session = noteSession;
    if (!update || !session || session.control.terminal) return;
    const request = session.control.request;
    if (
      update.openId !== request.openId ||
      update.markId !== request.markId ||
      update.generation !== request.generation
    )
      return;
    if (!ownsNote(session)) {
      void cancelNote();
      return;
    }
    if (!update.final) {
      noteSession = {
        ...session,
        text: update.text,
        phase: session.phase === 'stopping' ? 'stopping' : 'listening',
      };
      return;
    }
    session.control.terminal = true;
    noteSession = null;
    if (update.error) {
      error = m.dock_screenshotEditor_dictationUnavailable();
      return;
    }
    const note = appendNote(session.baseline, update.text);
    if (!edits || note === session.baseline) return;
    const bundle = edits.draft;
    edits.apply({
      ...bundle,
      edit: {
        ...bundle.edit,
        marks: bundle.edit.marks.map((mark) =>
          mark.id === request.markId ? { ...mark, note } : mark,
        ),
      },
    });
  }
  $effect(() => {
    const update = noteDictationUpdate;
    untrack(() => receiveNote(update));
  });
  $effect(() => {
    const session = noteSession;
    if (!session) return;
    if (!ownsNote(session)) {
      void cancelNote();
      return;
    }
    if (selectedMarkId !== session.control.request.markId) stopNote(session.control.request.markId);
  });
  $effect(() => {
    const request = discardRequest;
    if (request > seenDiscardRequest) {
      seenDiscardRequest = request;
      if (noteSession) stopNote(noteSession.control.request.markId);
    }
  });
  function applyEditorEdit(edit: DockMediaEdit): void {
    if (!edits || saving || retaking) return;
    const next = { ...edits.draft, edit };
    if (noteSession && !ownsNote(noteSession, next)) void cancelNote();
    edits.apply(next);
  }
  function close(): void {
    if (saving || finishing) return;
    void cancelNote();
    onClose();
  }
  function discard(): void {
    void cancelNote();
    onDiscardRequested?.();
  }
  function undo(): void {
    if (noteSession) {
      void cancelNote();
      return;
    }
    if (!saving && !retaking) edits?.undo();
  }
  function redo(): void {
    if (noteSession) {
      void cancelNote();
      return;
    }
    if (!saving && !retaking) edits?.redo();
  }
  onDestroy(() => {
    void cancelNote();
    active = false;
  });
  $effect(() => onDirtyChange?.(dirty));
  // Blur strokes and sticky notes need the output owner's admitted version; an older
  // pipeline would drop them, so such an edit is not saved there.
  const needsNewOutput = $derived(
    !!edits &&
      (!!edits.draft.edit.blurStrokes?.length ||
        edits.draft.edit.marks.some(
          (mark) => mark.geometry.kind === 'text' && mark.geometry.style === 'sticky',
        )),
  );
  const outputAdmitted = $derived(snapshot.output?.version === DOCK_MEDIA_OUTPUT_VERSION);
  /**
   * A crop being adjusted or text being typed is not in the draft yet: until it is
   * applied or cancelled, nothing saves or retakes (it would silently leave it out).
   */
  let interactionPending = $state(false);
  // Save is offered whenever this session can save at all, and stays in place; a
  // pending edit or an edit the output cannot carry only disables it.
  const saveCapable = $derived(!!onSave && !!snapshot.output?.ready && !!edits);
  const saveBlocked = $derived(interactionPending || (needsNewOutput && !outputAdmitted));
  const canSave = $derived(saveCapable && !saveBlocked);

  async function finishAttachment(): Promise<void> {
    if (!active || finishing || !ownsSnapshot()) return;
    finishing = true;
    onDirtyChange?.(false);
    try {
      const accepted = await (onAttach ?? onClose)();
      if (!active || !ownsSnapshot()) return;
      if (accepted === false) {
        error = m.dock_captureEditor_attachError();
        finishing = false;
      }
    } catch {
      if (active && ownsSnapshot()) {
        error = m.dock_captureEditor_attachError();
        finishing = false;
      }
    }
  }
  function attach(): void {
    if (!active || saving || finishing || retaking || noteSession || saveBlocked) return;
    if (dirty) void save(true);
    else void finishAttachment();
  }
  async function save(attachAfterSave = false) {
    if (
      !edits ||
      !onSave ||
      !canSave ||
      saving ||
      finishing ||
      retaking ||
      noteSession ||
      interactionPending
    )
      return;
    const bundle = edits.draft;
    if (planDockMediaOutput(bundle.edit, bundle.source, null).errors.length) {
      error = m.dock_screenshotEditor_saveError();
      return;
    }
    saving = true;
    error = null;
    try {
      const result = await onSave({
        edit: bundle.edit,
        ...(bundle.candidateToken
          ? { replacement: { candidateToken: bundle.candidateToken } }
          : {}),
      });
      if (!active || !ownsSnapshot() || edits.draft !== bundle) return;
      if (
        result.result !== 'saved' ||
        !result.saved ||
        result.saved.sourceId !== bundle.source.id ||
        result.saved.sourceRevision !== bundle.source.revision ||
        !DockMediaEditSchema.safeParse(result.saved).success ||
        planDockMediaOutput(result.saved, bundle.source, null).errors.length
      ) {
        error = m.dock_screenshotEditor_saveError();
        return;
      }
      edits.commit({ ...bundle, edit: result.saved });
      onDirtyChange?.(false);
      if (attachAfterSave) await finishAttachment();
    } catch {
      if (active) error = m.dock_screenshotEditor_saveError();
    } finally {
      if (active) saving = false;
    }
  }
  async function retake() {
    if (!edits || !onRetake || saving || retaking || interactionPending) return;
    const bundle = edits.draft;
    const stopping = cancelNote();
    retaking = true;
    error = null;
    try {
      await stopping;
      if (!active || !ownsSnapshot() || edits.draft !== bundle) return;
      const candidate = await onRetake(bundle);
      if (!active || !ownsSnapshot() || edits.draft !== bundle || !candidate) return;
      if (
        !DockMediaSourceSchema.safeParse(candidate.source).success ||
        typeof candidate.candidateToken !== 'string' ||
        !candidate.candidateToken.trim() ||
        candidate.candidateToken.length > 512
      )
        throw new Error('Invalid screenshot candidate source');
      edits.apply({
        source: candidate.source,
        candidateToken: candidate.candidateToken,
        mediaUrl: candidate.mediaUrl,
        edit: retakeScreenshotEdit(bundle.edit, candidate.source, candidate.mapping),
      });
    } catch {
      if (active) error = m.dock_screenshotEditor_retakeError();
    } finally {
      if (active) retaking = false;
    }
  }
</script>

{#if edits}
  <DockScreenshotEditor
    source={edits.draft.source}
    sourceUrl={edits.draft.mediaUrl}
    draft={edits.draft.edit}
    onChange={applyEditorEdit}
    bind:selectedMarkId
    {notePreview}
    onNoteManualEdit={(markId) => {
      void cancelNote(markId);
    }}
    onNoteBlur={stopNote}
    disabled={saving}
    {retaking}
    onInteractionPending={(pending) => (interactionPending = pending)}
    admittedOutputVersion={outputAdmitted ? DOCK_MEDIA_OUTPUT_VERSION : undefined}
    {dictatingId}
    onRetake={onRetake ? retake : undefined}
    onNoteDictation={onNoteDictation ? dictateNote : undefined}
  >
    {#snippet children(contentMain, contentSidebar)}
      <DockCaptureEditorShell
        title={m.dock_screenshotEditor_title()}
        subtitle={snapshot.title}
        {dirty}
        saving={saving || finishing || !!noteSession}
        {saveBlocked}
        onCancel={close}
        onSave={saveCapable ? () => void save() : undefined}
        onAttach={attach}
        onUndo={undo}
        onRedo={redo}
        {discardRequest}
        onDiscardRequested={discard}
        {onKeepEditing}
        sidebar={contentSidebar}
        sidebarWidth={260}
        sidebarLayout="panel"
        actionsPlacement="sidebar"
      >
        {#snippet main()}
          {#if error}<p class="status type-caption" role="alert">{error}</p>{/if}
          {#if !saveCapable}<p class="status type-caption">
              {m.dock_screenshotEditor_previewOnly()}
            </p>{/if}
          {@render contentMain()}
        {/snippet}
      </DockCaptureEditorShell>
    {/snippet}
  </DockScreenshotEditor>
{:else}
  <DockCaptureEditorShell
    onAttach={attach}
    saving={finishing}
    title={m.dock_screenshotEditor_title()}
    subtitle={snapshot.title}
    onCancel={onClose}
    {discardRequest}
    {onDiscardRequested}
    {onKeepEditing}
  >
    {#snippet main()}
      {#if error}<p class="status type-caption" role="alert">{error}</p>{/if}
      <p class="status type-caption">{m.dock_screenshotEditor_legacyReadonly()}</p>
      <img class="original" src={snapshot.mediaUrl} alt={snapshot.title} />
    {/snippet}
  </DockCaptureEditorShell>
{/if}

<style>
  .status {
    margin: 0;
    padding: 12px 16px;
    color: hsl(var(--muted-foreground));
    line-height: 1.5;
  }
  .original {
    display: block;
    max-width: 100%;
    height: auto;
    margin: auto;
  }
</style>
