<script lang="ts" module>
  import type { DockMediaEdit, DockMediaSource } from '$shared/dock-media-edit';
  import type { ScreenshotFrameMapping } from './screenshot-edit-geometry';
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
  import { onDestroy } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type {
    DockCaptureEditorSnapshot,
    DockCaptureEditorSaveResult,
  } from '$shared/dock-capture-editor';
  import {
    defaultDockMediaEdit,
    DockMediaEditSchema,
    DockMediaSourceSchema,
    planDockMediaOutput,
  } from '$shared/dock-media-edit';
  import { Button } from '$lib/components/ui/button';
  import { ActionMenu } from '$lib/components/patterns/action-menu';
  import DotsThreeIcon from 'phosphor-svelte/lib/DotsThreeIcon';
  import DockCaptureEditorShell from '../DockCaptureEditorShell.svelte';
  import { createEditTransaction } from '../edit-transaction.svelte';
  import DockScreenshotEditor from './DockScreenshotEditor.svelte';
  import { retakeScreenshotEdit } from './screenshot-edit-geometry';

  let {
    snapshot,
    captureBaseline,
    onClose,
    discardRequest = 0,
    onDirtyChange,
    onDiscardRequested,
    onKeepEditing,
    onSave,
    onRetake,
    onNoteDictation,
    dictatingId = null,
  }: {
    snapshot: DockCaptureEditorSnapshot;
    /** Main-provided capture baseline; never inferred from the current saved edit. */
    captureBaseline?: ScreenshotEditorBundle;
    onClose: () => void;
    discardRequest?: number;
    onDirtyChange?: (dirty: boolean) => void;
    onDiscardRequested?: () => void;
    onKeepEditing?: () => void;
    onSave?: (request: {
      edit: DockMediaEdit;
      replacement?: { candidateToken: string };
    }) => Promise<DockCaptureEditorSaveResult>;
    onRetake?: (bundle: ScreenshotEditorBundle) => Promise<ScreenshotRetakeCandidate | null>;
    onNoteDictation?: (markId: string, phase: 'start' | 'stop') => void;
    dictatingId?: string | null;
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
    // The legacy mark list has no geometry. Never turn it into an invented edit.
    if (!value.saved && value.marks.length) return null;
    const edit = value.saved ?? defaultDockMediaEdit(source, [], value.transcript ?? null);
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
  const edits = initial ? createEditTransaction(initial) : null;
  function authoritativeBaseline(
    value: ScreenshotEditorBundle | undefined,
  ): ScreenshotEditorBundle | null {
    if (
      !value ||
      !initial ||
      value.source.kind !== 'screenshot' ||
      value.source.visuals !== 'clean'
    )
      return null;
    if (
      value.candidateToken !== undefined &&
      (!value.candidateToken.trim() || value.candidateToken.length > 512)
    )
      return null;
    const sameSource =
      value.source.id === initial.source.id && value.source.revision === initial.source.revision;
    if (!sameSource && !value.candidateToken) return null;
    return DockMediaSourceSchema.safeParse(value.source).success &&
      DockMediaEditSchema.safeParse(value.edit).success &&
      !planDockMediaOutput(value.edit, value.source, null).errors.length
      ? value
      : null;
  }
  const original = $derived(authoritativeBaseline(captureBaseline));
  let active = true;
  let saving = $state(false);
  let retaking = $state(false);
  let error = $state<string | null>(null);
  onDestroy(() => {
    active = false;
  });
  $effect(() => onDirtyChange?.(edits?.dirty ?? false));
  const canSave = $derived(!!onSave && !!snapshot.output?.ready && !!edits);

  async function save() {
    if (!edits || !onSave || !canSave || saving || retaking) return;
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
      if (!active || snapshot.openId !== openId || edits.draft !== bundle) return;
      if (
        result.result !== 'saved' ||
        !result.saved ||
        !DockMediaEditSchema.safeParse(result.saved).success ||
        planDockMediaOutput(result.saved, bundle.source, null).errors.length
      ) {
        error = m.dock_screenshotEditor_saveError();
        return;
      }
      edits.commit({ ...bundle, edit: result.saved });
      onDirtyChange?.(false);
      onClose();
    } catch {
      if (active) error = m.dock_screenshotEditor_saveError();
    } finally {
      if (active) saving = false;
    }
  }
  async function retake() {
    if (!edits || !onRetake || saving || retaking) return;
    const bundle = edits.draft;
    retaking = true;
    error = null;
    try {
      const candidate = await onRetake(bundle);
      if (!active || snapshot.openId !== openId || edits.draft !== bundle || !candidate) return;
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
    onChange={(edit) => {
      if (!saving && !retaking) edits.apply({ ...edits.draft, edit });
    }}
    disabled={saving}
    {retaking}
    {dictatingId}
    onRetake={onRetake ? retake : undefined}
    {onNoteDictation}
  >
    {#snippet children(contentMain, contentSidebar, contentHeader)}
      <DockCaptureEditorShell
        title={m.dock_screenshotEditor_title()}
        subtitle={snapshot.title}
        dirty={edits.dirty}
        {saving}
        onCancel={onClose}
        onSave={canSave ? save : undefined}
        onUndo={() => {
          if (!saving && !retaking) edits.undo();
        }}
        onRedo={() => {
          if (!saving && !retaking) edits.redo();
        }}
        {discardRequest}
        {onDiscardRequested}
        {onKeepEditing}
        sidebar={contentSidebar}
      >
        {#snippet main()}
          {#if error}<p class="status type-caption" role="alert">{error}</p>{/if}
          {#if !canSave}<p class="status type-caption">
              {m.dock_screenshotEditor_previewOnly()}
            </p>{/if}
          {@render contentMain()}
        {/snippet}
        {#snippet headerActions()}
          {@render contentHeader()}
          <ActionMenu
            ariaLabel={m.dock_screenshotEditor_more()}
            actions={[
              {
                id: 'reset',
                label: m.dock_screenshotEditor_reset(),
                disabled: saving || retaking || !original,
                disabledReason: original ? undefined : m.dock_screenshotEditor_resetUnavailable(),
              },
            ]}
            onAction={() => {
              if (original && !saving && !retaking) edits.reset(original);
            }}
          >
            {#snippet trigger({ props })}<Button
                {...props}
                variant="ghost"
                size="icon-sm"
                aria-label={m.dock_screenshotEditor_more()}><DotsThreeIcon size={18} /></Button
              >{/snippet}
          </ActionMenu>
        {/snippet}
      </DockCaptureEditorShell>
    {/snippet}
  </DockScreenshotEditor>
{:else}
  <DockCaptureEditorShell
    title={m.dock_screenshotEditor_title()}
    subtitle={snapshot.title}
    onCancel={onClose}
    {discardRequest}
    {onDiscardRequested}
    {onKeepEditing}
  >
    {#snippet main()}
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
