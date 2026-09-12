<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import type {
    ArtifactBlock as Block,
    ArtifactDocument,
    ArtifactSelection,
  } from '$shared/types/visual-artifact';
  import { m } from '$shared/paraglide/messages.js';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { writeTextToClipboard } from '$lib/utils/clipboard';
  import { store as appStore } from '$store/renderer/store';
  import { selectMostRecentAgentTab } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import {
    artifactLoadRequested,
    artifactSaveRequested,
    artifactCreateRequested,
    artifactCaptureRequested,
    artifactImagesRequested,
  } from '$store/renderer/slices/artifacts/artifacts-slice';
  import { selectArtifactImages } from '$store/renderer/slices/artifacts/artifacts-selectors';
  import ArtifactEditor from './components/ArtifactEditor.svelte';
  import { findArtifactDocument, serializeArtifactBlock } from './model';
  import type { LoadedArtifact } from './service';

  let {
    block,
    workspaceId,
    agentId,
    onChange,
    readonly = false,
  }: {
    block: Block;
    workspaceId?: string;
    agentId?: string;
    onChange?: (document: ArtifactDocument) => void;
    readonly?: boolean;
  } = $props();

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }
  let incoming = $state(untrack(() => JSON.stringify(block)));
  let current = $state.raw<ArtifactDocument | null>(
    untrack(() => ('document' in block ? clone(block.document) : null)),
  );
  let baseline = $state(untrack(() => (current ? JSON.stringify(current) : '')));
  let loaded = $state.raw<LoadedArtifact | null>(null);
  let shared = $state<{ noteId: string; artifactId: string } | null>(null);
  let selection = $state<ArtifactSelection>({ itemIds: [] });
  let comment = $state('');
  let busy = $state(false);
  let failed = $state(false);
  let conflict = $state(false);
  let status = $state<'saved' | 'added' | 'copied' | 'noAgent' | null>(null);
  let active = true;
  let identityEpoch = 0;
  let boundIdentity = '';
  const inputIdentity = $derived(
    JSON.stringify([
      workspaceId,
      'noteId' in block
        ? ['reference', block.noteId, block.artifactId]
        : ['document', block.document.id],
    ]),
  );
  function completionGuard() {
    const epoch = identityEpoch;
    const identity = inputIdentity;
    return () => active && epoch === identityEpoch && identity === inputIdentity;
  }
  let reference = $derived('noteId' in block ? block : shared);
  let dirty = $derived(current !== null && JSON.stringify(current) !== baseline);
  const note$ = selectNoteById(
    toStore(() => workspaceId),
    toStore(() => reference?.noteId),
  );
  const images$ = selectArtifactImages(toStore(() => workspaceId ?? ''));
  let sources = $derived(
    current
      ? [
          ...new Set([
            ...(current.image ? [current.image.src] : []),
            ...current.items.flatMap((item) =>
              item.type === 'image' && item.src ? [item.src] : [],
            ),
          ]),
        ]
      : [],
  );
  let imageSources = $derived(
    Object.fromEntries(
      Object.entries($images$).flatMap(([src, image]) =>
        image.dataUrl ? [[src, image.dataUrl]] : [],
      ),
    ),
  );
  let imageFailed = $derived(sources.some((src) => $images$[src]?.failed));
  let sourceKey = $derived(JSON.stringify(sources));
  $effect(() => {
    const key = sourceKey;
    if (workspaceId) appStore.dispatch(artifactImagesRequested(workspaceId, JSON.parse(key)));
  });
  let remote = $derived.by(() => {
    const note = $note$;
    if (
      !reference ||
      !note ||
      note.id !== reference.noteId ||
      note.workspaceId !== workspaceId ||
      note.rev === undefined
    )
      return null;
    const parsed = findArtifactDocument(note.content, reference.artifactId);
    return parsed ? { ...parsed, revision: note.rev } : null;
  });
  let stale = $derived(conflict || !!(loaded && remote && remote.revision > loaded.revision));

  function accept(next: LoadedArtifact) {
    loaded = clone(next);
    current = clone(next.document);
    baseline = JSON.stringify(next.document);
    selection = { itemIds: [] };
    conflict = false;
  }

  // Rebinding a reused node must invalidate every in-flight completion before loading its new target.
  $effect(() => {
    const identity = inputIdentity;
    untrack(() => {
      if (identity === boundIdentity) return;
      identityEpoch += 1;
      boundIdentity = identity;
      shared = null;
      loaded = null;
      current = 'document' in block ? clone(block.document) : null;
      baseline = current ? JSON.stringify(current) : '';
      incoming = JSON.stringify(block);
      selection = { itemIds: [] };
      comment = '';
      busy = false;
      failed = false;
      conflict = false;
      status = null;
      if ('noteId' in block) void reload();
    });
  });

  $effect(() => {
    const nextBlock = block;
    const next = JSON.stringify(nextBlock);
    untrack(() => {
      if (next === incoming) return;
      incoming = next;
      if ('document' in nextBlock && !reference) {
        if (dirty) conflict = true;
        else {
          current = clone(nextBlock.document);
          baseline = JSON.stringify(nextBlock.document);
          selection = { itemIds: [] };
        }
      }
    });
  });

  // Notes subscriptions already load changed content. Reconcile only clean local UI state.
  $effect(() => {
    const next = remote;
    untrack(() => {
      if (next && loaded && next.revision > loaded.revision && !dirty && !busy) accept(next);
    });
  });

  async function reload() {
    const isCurrent = completionGuard();
    if (busy) return;
    failed = false;
    status = null;
    if (workspaceId) appStore.dispatch(artifactImagesRequested(workspaceId, sources));
    if (!reference) {
      if ('document' in block) {
        current = clone(block.document);
        baseline = JSON.stringify(block.document);
        selection = { itemIds: [] };
        conflict = false;
      }
      return;
    }
    if (!workspaceId) {
      failed = true;
      return;
    }
    busy = true;
    try {
      const action = artifactLoadRequested(workspaceId, reference.noteId, reference.artifactId);
      appStore.dispatch(action);
      const next = await action.promise;
      if (isCurrent()) accept(next);
    } catch {
      if (isCurrent()) failed = true;
    } finally {
      if (isCurrent()) busy = false;
    }
  }

  onDestroy(() => {
    active = false;
    identityEpoch += 1;
  });

  async function save() {
    const isCurrent = completionGuard();
    if (!current || busy || readonly || boundIdentity !== inputIdentity) return;
    if (reference && loaded?.document.id !== reference.artifactId) return;
    const snapshot = clone(current);
    failed = false;
    status = null;
    busy = true;
    try {
      if (reference && workspaceId && loaded) {
        const action = artifactSaveRequested(
          workspaceId,
          reference.noteId,
          clone(loaded),
          snapshot,
        );
        appStore.dispatch(action);
        const next = await action.promise;
        if (isCurrent()) accept(next);
      } else if (!reference && onChange) {
        onChange(snapshot);
        baseline = JSON.stringify(snapshot);
      } else return;
      if (isCurrent()) status = 'saved';
    } catch (error) {
      if (isCurrent()) {
        failed = true;
        conflict = error instanceof Error && error.name === 'ArtifactConflictError';
      }
    } finally {
      if (isCurrent()) busy = false;
    }
  }

  async function share() {
    const isCurrent = completionGuard();
    if (!current || !workspaceId || busy || boundIdentity !== inputIdentity) return;
    const snapshot = clone(current);
    busy = true;
    failed = false;
    try {
      const action = artifactCreateRequested(workspaceId, snapshot);
      appStore.dispatch(action);
      const created = await action.promise;
      if (!isCurrent()) return;
      shared = created;
      // Creation succeeded even if loading fails: retain the reference for copy/retry.
      const load = artifactLoadRequested(workspaceId, created.noteId, created.artifactId);
      appStore.dispatch(load);
      const next = await load.promise;
      if (isCurrent()) {
        accept(next);
        status = 'saved';
      }
    } catch {
      if (isCurrent()) failed = true;
    } finally {
      if (isCurrent()) busy = false;
    }
  }

  async function copyEmbed() {
    const isCurrent = completionGuard();
    if (!reference) return;
    try {
      await writeTextToClipboard(serializeArtifactBlock(reference));
      if (isCurrent()) status = 'copied';
    } catch {
      if (isCurrent()) failed = true;
    }
  }

  function addComment() {
    if (!current || !comment.trim() || readonly || busy) return;
    current = {
      ...current,
      annotations: [
        ...current.annotations,
        {
          id: crypto.randomUUID(),
          selection: clone(selection),
          text: comment.trim(),
        },
      ],
    };
    comment = '';
    status = null;
  }

  async function addToChat() {
    const isCurrent = completionGuard();
    if (!current || !workspaceId || busy || boundIdentity !== inputIdentity) return;
    const target = agentId ?? selectMostRecentAgentTab.select(appStore.state, workspaceId)?.agentId;
    if (!target) {
      status = 'noAgent';
      return;
    }
    try {
      busy = true;
      failed = false;
      const action = artifactCaptureRequested(
        workspaceId,
        target,
        clone(current),
        clone(selection),
        {
          workspaceId,
          artifactId: current.id,
          noteId: reference?.noteId,
          revision: loaded?.revision,
        },
        comment,
      );
      appStore.dispatch(action);
      await action.promise;
      if (!isCurrent()) return;
      status = 'added';
    } catch {
      if (isCurrent()) failed = true;
    } finally {
      if (isCurrent()) busy = false;
    }
  }
</script>

<section class="my-2 min-w-0 rounded-(--radius-large) border border-border bg-background p-3">
  {#if current}
    <h3 class="mb-2 type-body font-semibold">{current.title}</h3>
    <ArtifactEditor
      document={current}
      {imageSources}
      {selection}
      readonly={readonly || busy}
      onChange={(next) => {
        current = clone(next);
        status = null;
      }}
      onSelect={(next) => {
        selection = clone(next);
        status = null;
      }}
    />
    {#if current.kind !== 'image' && current.annotations.length > 0}
      <ul class="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {#each current.annotations as annotation (annotation.id)}
          <li>
            <Button
              size="sm"
              variant="ghost"
              class="h-auto w-full justify-start whitespace-normal break-words text-left"
              aria-pressed={JSON.stringify(selection) === JSON.stringify(annotation.selection)}
              onclick={() => {
                selection = clone(annotation.selection);
                status = null;
              }}
            >
              {annotation.text}
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="mt-3 flex flex-wrap items-center gap-2">
      {#if !readonly && (onChange || reference)}
        <Button
          size="sm"
          variant="outline"
          onclick={save}
          disabled={busy || !dirty || stale || (!!reference && !loaded)}
          >{m.artifacts_block_save_label()}</Button
        >
      {/if}
      <Button size="sm" variant="outline" onclick={reload} disabled={busy}
        >{m.artifacts_block_reload_label()}</Button
      >
      {#if reference}
        <Button size="sm" variant="outline" onclick={copyEmbed}
          >{m.artifacts_block_copy_label()}</Button
        >
      {:else if workspaceId}
        <Button size="sm" variant="outline" onclick={share} disabled={busy}
          >{m.artifacts_block_share_label()}</Button
        >
      {/if}
      <Button size="sm" onclick={addToChat} disabled={!workspaceId || busy}
        >{m.artifacts_block_add_label()}</Button
      >
    </div>
    <div class="mt-2 flex gap-2">
      <Input
        class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 type-body"
        aria-label={m.artifacts_block_comment_placeholder()}
        placeholder={m.artifacts_block_comment_placeholder()}
        bind:value={comment}
        maxlength={16000}
      />
      {#if !readonly}<Button
          size="sm"
          variant="outline"
          onclick={addComment}
          disabled={!comment.trim() || busy || current.annotations.length >= 200}
          >{m.artifacts_block_comment_label()}</Button
        >{/if}
    </div>
    {#if dirty}<p class="mt-2 type-caption text-muted-foreground">
        {m.artifacts_block_dirty_description()}
      </p>{/if}
    {#if !reference && !onChange}<p class="mt-2 type-caption text-muted-foreground">
        {m.artifacts_block_snapshot_description()}
      </p>{/if}
    {#if reference}<pre class="mt-2 overflow-x-auto type-caption">{serializeArtifactBlock(
          reference,
        )}</pre>{/if}
  {:else}
    <p>{m.artifacts_block_loading_label()}</p>
    {#if !busy}<Button size="sm" onclick={reload}>{m.artifacts_block_reload_label()}</Button>{/if}
  {/if}
  {#if stale}<p role="status" class="mt-2 type-body">
      {m.artifacts_block_stale_description()}
    </p>{/if}
  {#if failed || imageFailed}<p role="alert" class="mt-2 type-body text-danger">
      {m.artifacts_block_failed_error()}
    </p>{/if}
  {#if status}<p role="status" class="mt-2 type-caption">
      {status === 'saved'
        ? m.artifacts_block_saved_label()
        : status === 'added'
          ? m.artifacts_block_added_label()
          : status === 'copied'
            ? m.artifacts_block_copyDone_label()
            : m.artifacts_block_noAgent_error()}
    </p>{/if}
</section>
