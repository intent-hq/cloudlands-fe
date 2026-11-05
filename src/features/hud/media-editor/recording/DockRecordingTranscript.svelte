<script lang="ts">
  import { tick } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type {
    DockMediaBatch,
    DockMediaEditMark,
    DockMediaRange,
    DockMediaTranscript,
  } from '$shared/dock-media-edit';
  import DockComposerIcon, {
    type DockComposerGlyph,
  } from '../../components/DockComposerIcon.svelte';
  import { formatRecordingTime } from './recording-editor-model';
  import { currentWordId, layoutTranscript } from './recording-transcript-model';

  /**
   * The transcript (Capture and recording editor spec, "Transcript and marks"): a
   * header at each batch start, marks inline as pills at the word spoken when they
   * happened, the current word highlighted and kept in view. Clicking a timed word or
   * a pill moves the shared playhead; untimed text cannot be jumped to. It stays
   * usable, dimmed, when the voice choice is not Transcript.
   *
   * Editing (with the callbacks): select words and press Delete to cut that stretch
   * (struck here, hatched on the timeline); click a struck passage to restore it.
   * Double-click a word to correct it: corrections change the text sent, not the audio.
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
    onToggleMark,
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
    /** Shift-click a pill: include or exclude that mark. */
    onToggleMark?: (markId: string) => void;
  } = $props();

  type Word = DockMediaTranscript['words'][number];
  /** The cut a timed word falls in, if any. */
  function cutOf(word: Word): DockMediaRange | null {
    if (word.startMs === null || word.endMs === null) return null;
    return cuts.find((cut) => word.startMs! >= cut.startMs && word.endMs! <= cut.endMs) ?? null;
  }

  let editing = $state<{ id: string; value: string } | null>(null);
  function commitEdit(word: Word): void {
    const current = editing;
    editing = null;
    if (!current || current.id !== word.id || !onWordEdit) return;
    const value = current.value.trim();
    const shown = wordEdits[word.id] ?? word.text;
    if (!value || value === shown) return;
    onWordEdit(word.id, value === word.text ? null : value);
  }

  /** Delete or Backspace with words selected in the transcript cuts their stretch. */
  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || !onCut || !list || editing) return;
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
  const current = $derived(ready ? currentWordId(ready.words, currentMs) : null);
  const glyphs: Record<DockMediaEditMark['kind'], DockComposerGlyph> = {
    click: 'click',
    element: 'click',
    box: 'box',
    draw: 'pen',
    arrow: 'arrow',
    text: 'pencil',
  };

  let list = $state<HTMLElement | null>(null);
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
  function onWordDoubleClick(event: MouseEvent): void {
    if (!onWordEdit || !ready) return;
    const id = (event.target as Element).closest<HTMLElement>('[data-word-id]')?.dataset.wordId;
    const word = id ? ready.words.find((row) => row.id === id) : undefined;
    if (!word) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    editing = { id: word.id, value: wordEdits[word.id] ?? word.text };
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<section class="transcript" data-transcript data-dimmed={dimmed || undefined}>
  {#if !transcript || transcript.status === 'unavailable' || transcript.status === 'failed'}
    <p class="status">{m.dock_captureEditor_transcript_unavailable()}</p>
  {:else if transcript.status === 'pending'}
    <p class="status" role="status">{m.dock_captureEditor_transcript_pending()}</p>
  {:else if transcript.status === 'no-speech'}
    <p class="status">{m.dock_captureEditor_transcript_noSpeech()}</p>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -- word clicks are a pointer shortcut; marks (buttons) and the timeline carry keyboard navigation -->
    <div class="batches" bind:this={list} onclick={onWordClick} ondblclick={onWordDoubleClick}>
      {#each layout as batch (batch.id)}
        <div class="batch" data-batch={batch.n}>
          <h3 class="batch-header">
            {m.dock_captureEditor_batch_label({
              n: batch.n,
              time: formatRecordingTime(batch.atMs),
            })}
            · {batch.markCount === 1
              ? m.dock_captureEditor_markCount_one()
              : m.dock_captureEditor_markCount_other({ count: batch.markCount })}
          </h3>
          <p class="text">
            {#each batch.pieces as piece, index (piece.kind === 'word' ? piece.word.id : `m:${piece.mark.id}:${index}`)}
              {#if piece.kind === 'word' && editing?.id === piece.word.id}
                {@const word = piece.word}
                <Input
                  class="word-input"
                  size="sm"
                  aria-label={m.dock_captureEditor_wordEdit_label()}
                  bind:value={editing.value}
                  autofocus
                  onblur={() => commitEdit(word)}
                  onkeydown={(event: KeyboardEvent) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') commitEdit(word);
                    else if (event.key === 'Escape') editing = null;
                  }}
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
                  size="sm"
                  class="mark-pill"
                  data-mark-pill={piece.mark.id}
                  data-active={piece.mark.id === activeMarkId || undefined}
                  data-excluded={!piece.mark.included || undefined}
                  aria-label={m.dock_captureEditor_pin_ariaLabel({
                    mark: piece.mark.label || piece.mark.kind,
                    time: formatRecordingTime(piece.mark.atMs),
                  })}
                  tooltip={onToggleMark ? m.dock_captureEditor_toggleMark_tooltip() : undefined}
                  onclick={(event: MouseEvent) => {
                    if (event.shiftKey && onToggleMark) onToggleMark(piece.mark.id);
                    else onMark(piece.mark);
                  }}
                >
                  <DockComposerIcon glyph={glyphs[piece.mark.kind]} size={11} />
                  <span>{piece.mark.label || piece.mark.kind}</span>
                </Button>{' '}
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
    padding: 12px;
    font-size: 12px;
    line-height: 1.6;
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
  .batch-header {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 500;
    color: hsl(var(--muted-foreground));
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
  .text :global(.word-input) {
    display: inline-block;
    width: 8em;
    height: 20px;
    font-size: 12px;
  }
  .word[data-untimed] {
    color: hsl(var(--muted-foreground));
  }
  .text :global(.mark-pill) {
    display: inline-flex;
    gap: 4px;
    height: 18px;
    padding: 0 6px;
    border-radius: 5px;
    background: hsl(var(--secondary));
    font-size: 11px;
    vertical-align: baseline;
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
