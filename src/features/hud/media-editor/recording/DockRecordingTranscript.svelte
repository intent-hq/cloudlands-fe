<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import TranscriptTextRun from './TranscriptTextRun.svelte';
  import { isTextEntryTarget } from '$lib/utils/text-entry';
  import type {
    DockMediaBatch,
    DockMediaEditMark,
    DockMediaRange,
    DockMediaTranscript,
  } from '$shared/dock-media-edit';
  import { formatInteger } from '$lib/i18n/format';
  import { currentWordId, layoutTranscript } from './recording-transcript-model';

  /**
   * The transcript (Capture and recording editor spec, "Transcript and marks"): a
   * header at each batch start, marks inline as pills at the word spoken when they
   * happened, the current word highlighted and kept in view. Clicking a timed word or
   * a pill moves the shared playhead; untimed text cannot be jumped to. It stays
   * usable, dimmed, when the voice choice is not Transcript.
   *
   * Editable passages use ordinary continuous text selection and native text Undo.
   * Draft corrections update as the person types; original recognition timing and
   * annotation anchors stay fixed. Playback-only words retain seek/cut navigation.
   */
  let {
    transcript,
    batches,
    marks,
    currentMs,
    activeMarkId = null,
    dimmed = false,
    onSeek,
    onMark,
    cuts = [],
    wordEdits = {},
    onCut,
    onRestore,
    onWordEdit,
    onWordEdits,
    onSubmit,
    locked = false,
    onDeleteMark,
    markNumbers,
    onInteractionPending,
  }: {
    transcript: DockMediaTranscript | null;
    batches: readonly DockMediaBatch[];
    marks: readonly DockMediaEditMark[];
    currentMs: number;
    activeMarkId?: string | null;
    dimmed?: boolean;
    onSeek: (ms: number) => void;
    onMark: (mark: DockMediaEditMark) => void;
    cuts?: readonly DockMediaRange[];
    /** Corrected text by recognition unit id. */
    wordEdits?: Readonly<Record<string, string>>;
    onCut?: (range: DockMediaRange) => void;
    onRestore?: (range: DockMediaRange) => void;
    /** `text` null drops the correction (back to what was recognized). */
    onWordEdit?: (wordId: string, text: string | null) => void;
    onWordEdits?: (changes: Record<string, string | null>) => void;
    onSubmit?: () => void;
    locked?: boolean;
    onDeleteMark?: (markId: string) => void;
    markNumbers?: Readonly<Record<string, number>>;
    onInteractionPending?: (pending: boolean) => void;
  } = $props();

  type Word = DockMediaTranscript['words'][number];
  /** The cut a timed word falls in, if any. */
  function cutOf(word: Word): DockMediaRange | null {
    if (word.startMs === null || word.endMs === null) return null;
    return cuts.find((cut) => word.startMs! >= cut.startMs && word.endMs! <= cut.endMs) ?? null;
  }

  let composing = $state(false);
  $effect(() => onInteractionPending?.(composing));
  onDestroy(() => onInteractionPending?.(false));
  function correctText(changes: Record<string, string | null>): void {
    if (locked) return;
    if (onWordEdits) onWordEdits(changes);
    else for (const [id, text] of Object.entries(changes)) onWordEdit?.(id, text);
  }

  /** Delete or Backspace with words selected in the transcript cuts their stretch. */
  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || !onCut || !list || locked || isTextEntryTarget(event.target))
      return;
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!list.contains(range.commonAncestorContainer)) return;
    let startMs = Infinity;
    let endMs = -Infinity;
    for (const node of list.querySelectorAll<HTMLElement>('[data-start][data-end]')) {
      if (!range.intersectsNode(node)) continue;
      startMs = Math.min(startMs, Number(node.dataset.start));
      endMs = Math.max(endMs, Number(node.dataset.end));
    }
    if (!Number.isFinite(startMs) || !(endMs > startMs)) return;
    event.preventDefault();
    selection.removeAllRanges();
    onCut({ startMs, endMs });
  }

  const ready = $derived(transcript?.status === 'ready' ? transcript : null);
  const layout = $derived(ready ? layoutTranscript(ready.words, batches, marks) : []);
  const runs = $derived(
    layout.map((batch) => {
      type Piece = (typeof batch.pieces)[number] | { kind: 'text'; words: Word[] };
      const pieces: Piece[] = [];
      for (const piece of batch.pieces) {
        if (piece.kind === 'word' && (onWordEdits || onWordEdit) && !cutOf(piece.word)) {
          const previous = pieces.at(-1);
          if (previous?.kind === 'text') previous.words.push(piece.word);
          else pieces.push({ kind: 'text', words: [piece.word] });
        } else pieces.push(piece);
      }
      return { ...batch, pieces };
    }),
  );
  const current = $derived(ready ? currentWordId(ready.words, currentMs) : null);

  let list = $state<HTMLElement | null>(null);
  const numbers = $derived(
    markNumbers ?? Object.fromEntries(marks.map((mark, index) => [mark.id, index + 1])),
  );
  function deletePill(markId: string): void {
    if (!onDeleteMark || locked) return;
    const before = [...(list?.querySelectorAll<HTMLElement>('[data-mark-pill]') ?? [])];
    const index = before.findIndex((node) => node.dataset.markPill === markId);
    onDeleteMark(markId);
    void tick().then(() => {
      const remaining = list?.querySelectorAll<HTMLElement>('[data-mark-pill]');
      const next = remaining?.[Math.min(Math.max(0, index), remaining.length - 1)];
      (next ?? list)?.focus({ preventScroll: true });
    });
  }

  // Keep the current word in view as it plays.
  $effect(() => {
    const id = current;
    if (!id || !list) return;
    void tick().then(() =>
      list
        ?.querySelector(`[data-word-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  });

  /**
   * A click on a timed word moves the playhead to it; on a struck (cut) word, it
   * restores that cut. Delegated: words are not buttons.
   */
  function onWordClick(event: MouseEvent): void {
    if (locked) return;
    if (window.getSelection()?.isCollapsed === false) return;
    const word = (event.target as Element).closest<HTMLElement>('[data-start]');
    if (!word) return;
    const cutStart = Number(word.dataset.cutStart);
    const cutEnd = Number(word.dataset.cutEnd);
    if (onRestore && Number.isFinite(cutStart) && Number.isFinite(cutEnd)) {
      onRestore({ startMs: cutStart, endMs: cutEnd });
      return;
    }
    const start = Number(word.dataset.start);
    if (Number.isFinite(start)) onSeek(start);
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<section class="transcript" data-transcript data-dimmed={dimmed || undefined}>
  {#if !transcript || transcript.status === 'unavailable' || transcript.status === 'failed'}
    <!-- Why there are no words, as the recognizer reported it; "no speech" is only a
         recognition that finished and heard none. -->
    <p class="status" data-transcript-reason={transcript?.error ?? undefined}>
      {transcript?.error === 'no-audio-track'
        ? m.dock_captureEditor_transcript_noAudio()
        : transcript?.error === 'speech-not-authorized'
          ? m.dock_captureEditor_transcript_speechOff()
          : transcript?.error === 'on-device-unavailable'
            ? m.dock_captureEditor_transcript_onDeviceUnavailable()
            : transcript?.status === 'failed'
              ? m.dock_captureEditor_transcript_failed()
              : m.dock_captureEditor_transcript_unavailable()}
    </p>
  {:else if transcript.status === 'pending'}
    <p class="status" role="status">{m.dock_captureEditor_transcript_pending()}</p>
  {:else if transcript.status === 'no-speech'}
    <p class="status">{m.dock_captureEditor_transcript_noSpeech()}</p>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -- word clicks are a pointer shortcut; marks (buttons) and the timeline carry keyboard navigation -->
    <div class="batches" role="group" tabindex="-1" bind:this={list} onclick={onWordClick}>
      {#each runs as batch (batch.id)}
        <div class="batch" data-batch={batch.n}>
          <p class="text">
            {#each batch.pieces as piece, index (piece.kind === 'text' ? `t:${piece.words[0].id}` : piece.kind === 'word' ? piece.word.id : `m:${piece.mark.id}:${index}`)}
              {#if piece.kind === 'text'}
                <TranscriptTextRun
                  words={piece.words}
                  {wordEdits}
                  {locked}
                  {onSubmit}
                  onChange={correctText}
                  onComposing={(value) => (composing = value)}
                />{' '}
              {:else if piece.kind === 'word'}
                {@const cut = cutOf(piece.word)}
                <span
                  class="word"
                  data-word-id={piece.word.id}
                  data-start={piece.timed ? piece.word.startMs : undefined}
                  data-end={piece.timed ? piece.word.endMs : undefined}
                  data-cut-start={cut?.startMs}
                  data-cut-end={cut?.endMs}
                  data-cut={cut ? '' : undefined}
                  data-edited={piece.word.id in wordEdits || undefined}
                  data-current={piece.word.id === current || undefined}
                  data-untimed={!piece.timed || undefined}
                  title={cut && onRestore ? m.dock_captureEditor_restoreCut_tooltip() : undefined}
                  >{wordEdits[piece.word.id] ?? piece.word.text}</span
                >{' '}
              {:else}
                <Button
                  variant="plain"
                  size="compact"
                  class="mark-pill"
                  data-mark-pill={piece.mark.id}
                  data-active={piece.mark.id === activeMarkId || undefined}
                  aria-label={formatInteger(numbers[piece.mark.id])}
                  disabled={locked}
                  onclick={() => onMark(piece.mark)}
                  onkeydown={(event: KeyboardEvent) => {
                    if (
                      locked ||
                      !onDeleteMark ||
                      (event.key !== 'Delete' && event.key !== 'Backspace')
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    deletePill(piece.mark.id);
                  }}>{formatInteger(numbers[piece.mark.id])}</Button
                >{' '}
              {/if}
            {/each}
          </p>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .transcript {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 4px 8px;
    font-size: 12px;
    line-height: 1.7;
  }
  .transcript[data-dimmed] {
    opacity: 0.6;
  }
  .status {
    margin: 0;
    color: hsl(var(--muted-foreground));
  }
  .batch + .batch {
    margin-top: 12px;
  }
  .text {
    margin: 0;
  }
  .word[data-start] {
    cursor: pointer;
  }
  .word[data-current] {
    border-radius: 3px;
    background: hsl(var(--primary) / 0.2);
  }
  .word[data-cut] {
    text-decoration: line-through;
    color: hsl(var(--muted-foreground));
  }
  .word[data-edited] {
    text-decoration: underline dotted;
  }
  .word[data-untimed] {
    color: hsl(var(--muted-foreground));
  }
  /* A number in the running text: a rounded, brighter chip that sits on the text's line
     (no taller than it) with the same word gaps as the words around it. */
  .text :global(.mark-pill) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 16px;
    min-height: 0;
    margin: 0;
    padding: 0 5px;
    border-radius: 999px;
    background: hsl(var(--foreground) / 0.16);
    box-shadow: inset 0 0 0 1px hsl(var(--foreground) / 0.12);
    color: hsl(var(--foreground));
    font-size: 10.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    vertical-align: 0.05em;
  }
  .text :global(.mark-pill:hover:not(:disabled)) {
    background: hsl(var(--foreground) / 0.24);
  }
  .text :global(.mark-pill[data-active]) {
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }
  .text :global(.mark-pill[data-excluded]) {
    text-decoration: line-through;
    opacity: 0.6;
  }
</style>
