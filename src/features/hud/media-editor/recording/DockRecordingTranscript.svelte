<script lang="ts">
  import { tick } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import type {
    DockMediaBatch,
    DockMediaEditMark,
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
  }: {
    transcript: DockMediaTranscript | null;
    batches: readonly DockMediaBatch[];
    marks: readonly DockMediaEditMark[];
    currentMs: number;
    activeMarkId?: string | null;
    dimmed?: boolean;
    onSeek: (ms: number) => void;
    onMark: (mark: DockMediaEditMark) => void;
  } = $props();

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

  /** A click on a timed word moves the playhead to it (delegated: words are not buttons). */
  function onWordClick(event: MouseEvent): void {
    const word = (event.target as Element).closest<HTMLElement>('[data-start]');
    const start = Number(word?.dataset.start);
    if (word && Number.isFinite(start)) onSeek(start);
  }
</script>

<section class="transcript" data-transcript data-dimmed={dimmed || undefined}>
  {#if !transcript || transcript.status === 'unavailable' || transcript.status === 'failed'}
    <p class="status">{m.dock_captureEditor_transcript_unavailable()}</p>
  {:else if transcript.status === 'pending'}
    <p class="status" role="status">{m.dock_captureEditor_transcript_pending()}</p>
  {:else if transcript.status === 'no-speech'}
    <p class="status">{m.dock_captureEditor_transcript_noSpeech()}</p>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -- word clicks are a pointer shortcut; marks (buttons) and the timeline carry keyboard navigation -->
    <div class="batches" bind:this={list} onclick={onWordClick}>
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
              {#if piece.kind === 'word'}
                <span
                  class="word"
                  data-word-id={piece.word.id}
                  data-start={piece.timed ? piece.word.startMs : undefined}
                  data-current={piece.word.id === current || undefined}
                  data-untimed={!piece.timed || undefined}>{piece.word.text}</span
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
                  onclick={() => onMark(piece.mark)}
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
