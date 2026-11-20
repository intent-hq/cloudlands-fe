<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { fade } from '$lib/motion';
  import DockComposerIcon from './DockComposerIcon.svelte';
  import DockComposerCapturePicker from './DockComposerCapturePicker.svelte';
  import DictationMeter from '$features/voice/components/DictationMeter.svelte';
  import type { DockComposerMediaFooterProps } from './dock-composer-media-presentation';

  let {
    state,
    labels,
    disabled = false,
    model,
    send,
    onCapture,
    onCaptureModeSelect,
    onRecordToggle,
    onDictationToggle,
    onDictationHoldStart,
    onDictationHoldEnd,
    onAlert,
  }: DockComposerMediaFooterProps = $props();

  const alerts = $derived(state.alerts ?? {});

  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let holdStarted = false;
  let suppressClick = false;
  let holdPointer: number | undefined;

  function endHold(): void {
    clearTimeout(holdTimer);
    holdPointer = undefined;
    if (!holdStarted) return;
    holdStarted = false;
    suppressClick = true;
    onDictationHoldEnd();
  }
  onDestroy(endHold);
  $effect(() => {
    if (disabled || state.dictationDisabled) endHold();
  });
  function beginHold(event: PointerEvent): void {
    if (event.button !== 0 || disabled || state.dictationDisabled || state.dictationPending) return;
    // A permission-blocked mic opens Settings on click; it never starts a hold.
    if (alerts.mic) return;
    event.preventDefault();
    suppressClick = false;
    // An already live mic is stopped by a normal click, never started a second time.
    if (state.dictating) return;
    holdPointer = event.pointerId;
    event.currentTarget instanceof HTMLElement &&
      event.currentTarget.setPointerCapture(event.pointerId);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (holdPointer === undefined) return;
      holdStarted = true;
      suppressClick = true;
      onDictationHoldStart();
    }, 300);
  }
</script>

<div class="media-footer" class:embedded={!model && !send} data-dock-media-footer>
  {#if model}<div class="model">{@render model()}</div>{/if}
  <div class="flex-gap"></div>
  <div class="controls">
    <DockComposerCapturePicker
      {state}
      {labels}
      {disabled}
      {onCapture}
      onSelect={onCaptureModeSelect}
      onAlert={() => onAlert?.('capture')}
    />
    <Button
      variant="ghost-light"
      size="icon-sm"
      class="media-button recording-button pill-button"
      data-recording={state.recording || undefined}
      disabled={disabled || state.recordingDisabled || state.recordingPending}
      aria-label={state.recording
        ? labels.stopRecording
        : (labels.actionHints?.record.label ?? labels.record)}
      aria-pressed={state.recording}
      aria-busy={state.recordingPending || undefined}
      data-alert={alerts.record ? '' : undefined}
      tooltipContentClass="dock-chrome-tooltip"
      tooltip={alerts.record ??
        state.recordingTooltip ??
        (state.recording
          ? labels.stopRecording
          : (labels.actionHints?.record.label ?? labels.record))}
      tooltipShortcut={!alerts.record && !state.recordingTooltip
        ? labels.actionHints?.record.shortcut
        : undefined}
      onpointerdown={(event) => {
        if (event.pointerType === 'mouse') event.preventDefault();
      }}
      onclick={() => (alerts.record ? onAlert?.('record') : onRecordToggle())}
    >
      {#if alerts.record}<span class="alert-dot" aria-hidden="true"></span>{/if}
      <!-- The glyph cross-fades while the pill widens: camera to stop square and timer. -->
      {#key state.recording}
        <span class="record-glyph" in:fade|global={{ tier: 'fast' }}>
          {#if state.recording}
            <DockComposerIcon glyph="stop" size={16} /><span class="timer"
              >{state.recordingTime}</span
            >
          {:else}<DockComposerIcon glyph="video" />{/if}
        </span>
      {/key}
    </Button>
    <Button
      variant="ghost-light"
      size="icon-sm"
      class="media-button mic-button pill-button"
      data-recording={state.dictating || undefined}
      disabled={disabled || state.dictationDisabled || state.dictationPending}
      aria-label={state.dictating
        ? labels.stopDictating
        : (labels.actionHints?.dictate.label ?? labels.dictate)}
      aria-pressed={state.dictating}
      aria-busy={state.dictationPending || undefined}
      data-alert={alerts.mic ? '' : undefined}
      tooltipContentClass="dock-chrome-tooltip"
      tooltip={alerts.mic ??
        state.dictationTooltip ??
        (state.dictating
          ? labels.stopDictating
          : (labels.actionHints?.dictate.label ?? labels.dictate))}
      tooltipShortcut={!alerts.mic && !state.dictationTooltip
        ? labels.actionHints?.dictate.shortcut
        : undefined}
      onpointerdown={beginHold}
      onpointerup={endHold}
      onpointercancel={() => {
        endHold();
        suppressClick = true;
      }}
      onlostpointercapture={endHold}
      onclick={() => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        if (alerts.mic) onAlert?.('mic');
        else onDictationToggle();
      }}
    >
      {#if alerts.mic}<span class="alert-dot" aria-hidden="true"></span>{/if}
      <!-- Live: the pill widens to stop, elapsed time and level bars (the record pill's shape). -->
      {#key state.dictating}
        <span class="record-glyph" in:fade|global={{ tier: 'fast' }}>
          {#if state.dictating}
            <DockComposerIcon glyph="stop" size={16} /><DictationMeter
              elapsed={state.dictationTime}
              levels={state.inputLevels}
            />
          {:else}<DockComposerIcon glyph="mic" />{/if}
        </span>
      {/key}
    </Button>
  </div>
  {#if send}<div class="send">{@render send()}</div>{/if}
</div>

<style>
  .media-footer {
    display: flex;
    align-items: center;
    gap: 0;
    min-width: 0;
    min-height: 32px;
  }
  .media-footer.embedded {
    flex: 1;
  }
  .model {
    min-width: 24px;
    flex: 0 1 110px;
    overflow: hidden;
  }
  .flex-gap {
    flex: 1;
    min-width: 4px;
    display: flex;
    align-items: center;
    justify-content: end;
    gap: 6px;
    overflow: hidden;
  }
  .timer {
    flex: none;
    font-size: var(--text-caption-size);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .controls {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
  }
  .send {
    display: flex;
    flex: none;
    margin-inline-start: 6px;
  }
  .send :global(button) {
    width: 32px;
    height: 32px;
    border-radius: 8px;
  }
  .media-footer :global(.media-button) {
    position: relative;
    width: 30px;
    height: 30px;
    min-width: 30px;
    padding: 0;
    border-radius: 8px;
    color: hsl(var(--muted-foreground));
  }
  /* A live pill widens from 30px to its content: only these buttons size per frame. */
  .media-footer :global(.pill-button) {
    interpolate-size: allow-keywords;
    transition:
      width var(--spring-moderate) var(--spring-moderate-ease),
      padding var(--spring-moderate) var(--spring-moderate-ease),
      background-color var(--spring-fast) var(--spring-fast-ease);
  }
  .media-footer :global(.pill-button[data-recording]) {
    width: auto;
    padding-inline: 8px 10px;
  }
  .record-glyph {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  @container style(--motion-reduced: 1) {
    .media-footer :global(.pill-button) {
      transition: none;
    }
  }
  /* Idle and hover follow the spec's control states; hover fill is the app hover token. */
  .media-footer :global(.media-button:not([data-recording]):hover) {
    color: hsl(var(--foreground));
  }
  .media-footer :global(.media-button[data-recording]) {
    background: hsl(var(--capture-active));
    color: hsl(var(--capture-active-foreground));
  }
  /* Missing permission: the control keeps its glyph; a small alert dot marks it. */
  .media-footer :global(.alert-dot) {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: hsl(var(--capture-active));
    pointer-events: none;
  }
</style>
